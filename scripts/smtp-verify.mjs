/**
 * Verifies SMTP credentials/connectivity without sending mail.
 * Reads SMTP_* from the backend .env (or the process environment):
 *
 *   node scripts/smtp-verify.mjs
 */
import 'dotenv/config';
import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const port = Number(process.env.SMTP_PORT ?? 465);

if (!host || !user || !pass) {
  console.log('SMTP_SKIP: set SMTP_HOST / SMTP_USER / SMTP_PASS in .env first');
  process.exit(0);
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
  connectionTimeout: 15000,
});

try {
  await transporter.verify();
  console.log(`SMTP_OK: ${user} authenticated on ${host}:${port}`);
} catch (e) {
  console.log('SMTP_FAIL:', e.message);
  process.exit(1);
}
