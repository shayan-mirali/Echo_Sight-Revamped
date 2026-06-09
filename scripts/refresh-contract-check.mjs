/**
 * Verifies the token-refresh contract the Flutter app relies on:
 *   - an invalid/expired access token → 401 on authed routes (triggers refresh)
 *   - POST /auth/refresh rotates: returns a new access + new refresh token
 *   - the OLD refresh token is revoked after use (why the client single-flights)
 *   - the refreshed access token works on authed routes
 *
 *   node scripts/refresh-contract-check.mjs
 */
const BASE = process.env.BASE ?? 'http://localhost:3000';
const API = `${BASE}/api`;
let pass = true;
const check = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) pass = false;
};

async function req(method, path, { token, body } = {}) {
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

const email = `refresh_${Date.now()}@example.com`;
const reg = await req('POST', '/auth/register', {
  body: { email, password: 'password123', registeredName: 'Sam' },
});
check(reg.status === 201 && reg.body.accessToken && reg.body.refreshToken, 'register → access + refresh tokens');
const access0 = reg.body.accessToken;
const refresh0 = reg.body.refreshToken;

// authed call works with the fresh access token
const ok0 = await req('GET', '/me/settings', { token: access0 });
check(ok0.status === 200, 'authed GET /me/settings with valid token → 200');

// invalid access token → 401 (this is what makes the client attempt a refresh)
const bad = await req('GET', '/me/settings', { token: 'not.a.valid.jwt' });
check(bad.status === 401, 'authed GET with garbage token → 401');

// refresh rotates: new access + new refresh
const r1 = await req('POST', '/auth/refresh', { body: { refreshToken: refresh0 } });
check(r1.status === 200 || r1.status === 201, 'POST /auth/refresh → ok');
check(!!r1.body.accessToken && !!r1.body.refreshToken, 'refresh returns new access + refresh');
check(r1.body.refreshToken !== refresh0, 'refresh token rotated (new != old)');
const access1 = r1.body.accessToken;
const refresh1 = r1.body.refreshToken;

// old refresh token is now revoked → reuse fails (single-flight rationale)
const reuse = await req('POST', '/auth/refresh', { body: { refreshToken: refresh0 } });
check(reuse.status === 401, 'reusing the OLD refresh token → 401 (revoked)');

// the refreshed access token works
const ok1 = await req('GET', '/me/settings', { token: access1 });
check(ok1.status === 200, 'authed GET with refreshed token → 200');

// the new refresh token works for a subsequent refresh
const r2 = await req('POST', '/auth/refresh', { body: { refreshToken: refresh1 } });
check(r2.status === 200 || r2.status === 201, 'new refresh token works for the next rotation');

console.log(`\n${pass ? '✓ REFRESH CONTRACT OK' : '✗ REFRESH CONTRACT FAILED'}`);
process.exit(pass ? 0 : 1);
