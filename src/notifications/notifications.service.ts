import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import { isProduction } from '../common/env';

/**
 * Delivers transactional messages (OTP codes, etc.) over SMTP.
 *
 * Configure via env (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
 * `FROM_EMAIL`). When SMTP isn't configured the service degrades gracefully:
 * in dev it logs the code to the console so you can still test the flow; in
 * production it warns (and never logs the code — that would leak a credential).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter | null = null;
  private initialized = false;

  constructor(private readonly config: ConfigService) {}

  async sendOtp(email: string, code: string, purpose: string): Promise<void> {
    const minutes = Number(this.config.get('OTP_TTL_MINUTES') ?? 10);
    const action =
      purpose === 'RESET_PASSWORD' ? 'reset your password' : 'verify your account';

    const sent = await this.sendMail({
      to: email,
      subject: `Your EchoSight code: ${code}`,
      text:
        `Your EchoSight verification code is ${code}.\n\n` +
        `Use it to ${action}. It expires in ${minutes} minutes.\n\n` +
        `If you didn't request this, you can ignore this email.`,
      html: this.otpHtml(code, action, minutes),
    });

    if (isProduction()) {
      // Never log the code in production; only flag a delivery failure.
      if (!sent) {
        this.logger.warn(
          `OTP for ${email} could not be emailed (SMTP not configured or send failed).`,
        );
      }
    } else {
      // Dev convenience: always surface the code in logs (and email it too).
      this.logger.log(
        `OTP for ${email} [${purpose}] => ${code}${sent ? ' (emailed)' : ''}`,
      );
    }
  }

  /**
   * Send one message. Returns true if handed off to the SMTP server, false if
   * SMTP isn't configured or the send failed (callers decide how to degrade).
   */
  private async sendMail(opts: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<boolean> {
    const transporter = this.getTransporter();
    if (!transporter) return false;

    try {
      await transporter.sendMail({
        from: this.config.get<string>('FROM_EMAIL') ?? this.config.get<string>('SMTP_USER'),
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
      return true;
    } catch (err) {
      this.logger.error(`SMTP send failed: ${(err as Error).message}`);
      return false;
    }
  }

  /** Build (once) the SMTP transport from env, or null if not configured. */
  private getTransporter(): nodemailer.Transporter | null {
    if (this.initialized) return this.transporter;
    this.initialized = true;

    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (!host || !user || !pass) {
      this.logger.warn(
        'SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS) — OTP emails will not be sent.',
      );
      return null;
    }

    const port = Number(this.config.get('SMTP_PORT') ?? 465);
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // implicit TLS on 465; STARTTLS on 587
      auth: { user, pass },
    });
    this.logger.log(`SMTP transport ready (${host}:${port})`);
    return this.transporter;
  }

  private otpHtml(code: string, action: string, minutes: number): string {
    return `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0f766e;">EchoSight</h2>
        <p>Use this code to ${action}:</p>
        <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0f766e;">${code}</p>
        <p style="color: #555;">It expires in ${minutes} minutes. If you didn't request this, ignore this email.</p>
      </div>`;
  }
}
