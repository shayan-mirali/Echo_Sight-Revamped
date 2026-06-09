/**
 * Verifies the WebSocket hardening: invalid frames are rejected and a
 * persistently bad client is disconnected; the flood limiter drops excess
 * frames without killing the connection.
 *
 *   node scripts/ws-hardening-check.mjs
 */
import { io } from 'socket.io-client';

const BASE = process.env.BASE ?? 'http://localhost:3000';

async function token() {
  const email = `harden_${Date.now()}@example.com`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', registeredName: 'Test' }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
  return (await res.json()).accessToken;
}

function connect(accessToken) {
  return new Promise((resolve, reject) => {
    const s = io(`${BASE}/sound`, { auth: { token: accessToken }, transports: ['websocket'] });
    s.on('ready', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('no ready')), 4000);
  });
}

// 1. Invalid frames → disconnect after MAX_REJECTS (20).
async function testInvalidFrames(accessToken) {
  const s = await connect(accessToken);
  let disconnected = false;
  s.on('disconnect', () => (disconnected = true));
  for (let i = 0; i < 25; i++) s.emit('audio', { sampleRate: 999999, pcm16: '!!!not base64!!!' });
  await new Promise((r) => setTimeout(r, 800));
  s.disconnect();
  console.log(
    disconnected
      ? '✓ invalid-frame flood disconnected the client (as designed)'
      : '✗ client was NOT disconnected after invalid frames',
  );
  return disconnected;
}

// 2. Valid-frame flood → connection survives (excess frames silently dropped).
async function testRateLimit(accessToken) {
  const s = await connect(accessToken);
  let disconnected = false;
  let alerts = 0;
  s.on('disconnect', () => (disconnected = true));
  s.on('alert', () => alerts++);
  // 100 silent frames in a burst — well over WS_MAX_FRAMES_PER_SEC.
  const silent = Buffer.alloc(4096 * 2).toString('base64');
  for (let i = 0; i < 100; i++) s.emit('audio', { sampleRate: 16000, pcm16: silent });
  await new Promise((r) => setTimeout(r, 800));
  const stillConnected = s.connected && !disconnected;
  s.disconnect();
  console.log(
    stillConnected
      ? `✓ valid-frame flood survived (connection stayed up, ${alerts} alerts from silence)`
      : '✗ valid-frame flood killed the connection (rate limiter too aggressive)',
  );
  return stillConnected;
}

const t = await token();
const a = await testInvalidFrames(t);
const b = await testRateLimit(t);
console.log(`\n${a && b ? '✓ ALL HARDENING CHECKS PASSED' : '✗ SOME CHECKS FAILED'}`);
process.exit(a && b ? 0 : 1);
