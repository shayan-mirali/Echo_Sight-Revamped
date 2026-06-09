/**
 * Verifies the REST contract the Flutter app's settings + history sync rely on:
 *   GET/PATCH /me/settings (with partial classification merge) and
 *   GET/DELETE /me/alerts (single + clear). Streams one alert over WS first so
 *   there's something to fetch/delete.
 *
 *   node scripts/sync-contract-check.mjs
 */
import { io } from 'socket.io-client';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const API = `${BASE}/api`;
let pass = true;
const check = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) pass = false;
};

async function req(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function streamOneAlert(token) {
  return new Promise((resolve, reject) => {
    const s = io(`${BASE}/sound`, { auth: { token }, transports: ['websocket'] });
    let done = false;
    s.on('alert', (a) => { done = true; s.disconnect(); resolve(a); });
    s.on('ready', () => {
      // A loud 1 kHz tone → Siren.
      const n = 4096; const buf = Buffer.alloc(n * 2);
      for (let i = 0; i < n; i++) {
        const v = Math.sin((2 * Math.PI * 1000 * i) / 16000) * 0.6;
        buf.writeInt16LE((v * 32767) | 0, i * 2);
      }
      const send = () => { if (!done) { s.emit('audio', { sampleRate: 16000, pcm16: buf.toString('base64') }); setTimeout(send, 120); } };
      send();
    });
    s.on('connect_error', reject);
    setTimeout(() => { if (!done) { s.disconnect(); reject(new Error('no alert in time')); } }, 6000);
  });
}

const email = `sync_${Date.now()}@example.com`;
const reg = await req('POST', '/auth/register', null, {
  email, password: 'password123', registeredName: 'Jordan',
});
check(reg.status === 201 && reg.body.accessToken, 'register → token');
const token = reg.body.accessToken;

// ── Settings ──
const s0 = await req('GET', '/me/settings', token);
check(s0.status === 200 && s0.body.enabledClassifications?.Siren === true, 'GET settings → defaults (Siren enabled)');
check(s0.body.registeredName === 'Jordan', 'GET settings → registeredName from register');

const patch = await req('PATCH', '/me/settings', token, {
  themeMode: 'dark',
  sensitivityThreshold: 0.8,
  enabledClassifications: { Siren: false }, // partial — others must survive
});
check(patch.status === 200, 'PATCH settings → 200');

const s1 = await req('GET', '/me/settings', token);
check(s1.body.themeMode === 'dark', 'PATCH persisted themeMode=dark');
check(s1.body.sensitivityThreshold === 0.8, 'PATCH persisted sensitivity=0.8');
check(s1.body.enabledClassifications?.Siren === false, 'partial classification applied (Siren=false)');
check(s1.body.enabledClassifications?.['Car Horn'] === true, 'merge kept other classes (Car Horn=true)');

// ── Alerts ──
// Re-enable Siren (we disabled it above) + sane sensitivity so the test tone surfaces.
await req('PATCH', '/me/settings', token, {
  sensitivityThreshold: 0.6,
  enabledClassifications: { Siren: true },
});
let alert = null;
try {
  alert = await streamOneAlert(token);
} catch (e) {
  console.log(`  (stream error: ${e.message})`);
}
check(!!alert?.id, 'WS alert carries an id');

const a0 = await req('GET', '/me/alerts?limit=100', token);
check(a0.status === 200 && Array.isArray(a0.body) && a0.body.length >= 1, 'GET /me/alerts → list');
const first = a0.body[0];

const del = await req('DELETE', `/me/alerts/${first.id}`, token);
check(del.status === 200, 'DELETE /me/alerts/:id → 200');
const a1 = await req('GET', '/me/alerts', token);
check(!a1.body.some((x) => x.id === first.id), 'deleted alert is gone');

const clear = await req('DELETE', '/me/alerts', token);
check(clear.status === 200, 'DELETE /me/alerts (clear) → 200');
const a2 = await req('GET', '/me/alerts', token);
check(Array.isArray(a2.body) && a2.body.length === 0, 'clear emptied history');

console.log(`\n${pass ? '✓ SYNC CONTRACT OK' : '✗ SYNC CONTRACT FAILED'}`);
process.exit(pass ? 0 : 1);
