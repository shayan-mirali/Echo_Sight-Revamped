/**
 * End-to-end smoke test for the real-time sound pipeline.
 *
 *   1. registers (or logs in) a throwaway user over REST to get an access token
 *   2. opens the /sound WebSocket with that token
 *   3. streams synthetic audio frames that mimic each sound class
 *   4. prints the `alert` events the backend pushes back
 *
 * Run against a running server:  node scripts/sound-smoke.mjs
 */
import { io } from 'socket.io-client';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const SAMPLE_RATE = 16000;
const FRAME = 4096;

// ── Synthetic audio generators (return Int16LE base64) ────────────────────
function toBase64(float) {
  const buf = Buffer.alloc(float.length * 2);
  for (let i = 0; i < float.length; i++) {
    const s = Math.max(-1, Math.min(1, float[i]));
    buf.writeInt16LE((s * 32767) | 0, i * 2);
  }
  return buf.toString('base64');
}
function tone(freq, amp = 0.5, n = FRAME) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
  return out;
}
function speech(n = FRAME) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    out[i] =
      0.35 * Math.sin(2 * Math.PI * 180 * t) +
      0.3 * Math.sin(2 * Math.PI * 750 * t) +
      0.22 * Math.sin(2 * Math.PI * 1300 * t) +
      0.15 * Math.sin(2 * Math.PI * 2500 * t) +
      0.05 * (Math.sin(i * 12.9898) * 43758.5453 % 1); // light noise
  }
  return out;
}
function knock(n = FRAME) {
  const out = new Float32Array(n);
  // low-level broadband bed + a couple of sharp clicks (high crest factor)
  for (let i = 0; i < n; i++) out[i] = 0.02 * ((Math.sin(i * 78.233) * 43758.5453) % 1);
  for (const c of [200, 210, 1500, 1512]) out[c] = 0.95;
  return out;
}
const silence = () => new Float32Array(FRAME);

const CASES = [
  ['siren-like tone (1000Hz)', tone(1000, 0.6)],
  ['horn-like tone (400Hz)', tone(400, 0.6)],
  ['knock transient', knock()],
  ['speech-like', speech()],
  ['silence', silence()],
];

// ── REST helpers ──────────────────────────────────────────────────────────
async function post(path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function getToken() {
  const email = `smoke_${Date.now()}@example.com`;
  const password = 'Test1234!';
  let r = await post('/auth/register', { email, password, registeredName: 'Shayan' });
  if (r.status >= 400) r = await post('/auth/login', { email, password });
  if (!r.json?.accessToken) throw new Error(`auth failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.accessToken;
}

// ── Main ────────────────────────────────────────────────────────────────
const token = await getToken();
console.log('✓ got access token');

const socket = io(`${BASE}/sound`, { auth: { token }, transports: ['websocket'] });
const alerts = [];

socket.on('connect', () => console.log('✓ ws connected:', socket.id));
socket.on('ready', (d) => console.log('✓ ready:', JSON.stringify(d)));
socket.on('alert', (a) =>
  (alerts.push(a),
  console.log(`  🔔 ALERT  ${a.label.padEnd(11)} conf=${a.confidence.toFixed(2)} sev=${a.severity} angle=${a.angle}`)),
);
socket.on('error', (e) => console.error('  ✗ error:', e));
socket.on('connect_error', (e) => console.error('  ✗ connect_error:', e.message));

await new Promise((r) => socket.on('ready', r));

for (const [name, samples] of CASES) {
  console.log(`\n▶ sending ${name}`);
  // send the same frame a few times (cooldown collapses repeats into one alert)
  for (let i = 0; i < 3; i++) {
    socket.emit('audio', { sampleRate: SAMPLE_RATE, pcm16: toBase64(samples), seq: i });
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 300));
}

await new Promise((r) => setTimeout(r, 500));
console.log(`\n── done: ${alerts.length} alert(s) surfaced ──`);

// Verify REST history persisted them.
const hist = await fetch(`${BASE}/api/me/alerts?limit=20`, {
  headers: { authorization: `Bearer ${token}` },
}).then((r) => r.json());
console.log(`✓ GET /me/alerts returned ${Array.isArray(hist) ? hist.length : '?'} persisted alert(s)`);
console.log(`  (expect persisted == surfaced; cooldown prevents history flooding)`);

socket.disconnect();
setTimeout(() => process.exit(0), 50);
