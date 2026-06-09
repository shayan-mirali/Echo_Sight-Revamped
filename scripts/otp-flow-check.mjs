/**
 * Verifies the password-reset (OTP) contract the Flutter forgot-password flow
 * uses: forgot → verify (no consume) → reset (consume) → old password dead,
 * new password works, code can't be reused.
 *
 * Dev only: the OTP is read from the server log (NotificationsService logs it
 * in dev). Pass the log path as arg 1 (default /tmp/echo-server.log).
 *
 *   node scripts/otp-flow-check.mjs [serverLogPath]
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const API = `${BASE}/api`;
const LOG = process.argv[2] ?? '/tmp/echo-server.log';
let pass = true;
const check = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) pass = false;
};

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function latestOtp(email) {
  // NotificationsService logs: "OTP for <email> [RESET_PASSWORD] => 123456"
  const lines = readFileSync(LOG, 'utf8').split('\n').filter((l) => l.includes(`OTP for ${email}`));
  const last = lines[lines.length - 1] ?? '';
  const m = last.match(/=>\s*(\d{6})/);
  return m ? m[1] : null;
}

const email = `otp_${Date.now()}@example.com`;
const reg = await req('POST', '/auth/register', {
  email, password: 'oldpassword1', registeredName: 'Pat',
});
check(reg.status === 201, 'register → 201');

const forgot = await req('POST', '/auth/password/forgot', { email });
check(forgot.status === 200, 'POST /auth/password/forgot → 200 (no account leak)');

await new Promise((r) => setTimeout(r, 200)); // let the log flush
const code = latestOtp(email);
check(!!code, `OTP captured from dev log (${code ?? 'none'})`);

const badVerify = await req('POST', '/auth/otp/verify', { email, code: '000000' });
check(badVerify.body?.valid === false, 'verify wrong code → { valid: false }');

const goodVerify = await req('POST', '/auth/otp/verify', { email, code });
check(goodVerify.body?.valid === true, 'verify correct code → { valid: true }');

// verify must NOT consume — a second verify still works
const reVerify = await req('POST', '/auth/otp/verify', { email, code });
check(reVerify.body?.valid === true, 'verify does not consume the code');

const reset = await req('POST', '/auth/password/reset', {
  email, code, newPassword: 'newpassword2',
});
check(reset.status === 200, 'reset with valid code → 200');

const oldLogin = await req('POST', '/auth/login', { email, password: 'oldpassword1' });
check(oldLogin.status === 401, 'old password no longer works → 401');

const newLogin = await req('POST', '/auth/login', { email, password: 'newpassword2' });
check(newLogin.status === 200 && !!newLogin.body.accessToken, 'new password works → 200 + token');

const reuse = await req('POST', '/auth/password/reset', {
  email, code, newPassword: 'another3',
});
check(reuse.status === 401, 'consumed code cannot be reused → 401');

console.log(`\n${pass ? '✓ OTP FLOW CONTRACT OK' : '✗ OTP FLOW CONTRACT FAILED'}`);
process.exit(pass ? 0 : 1);
