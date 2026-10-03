import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';

/**
 * Generic transactional email sender shared by OTP delivery and the public
 * website leads module. Picks Resend (HTTPS API) when RESEND_API_KEY is
 * set, otherwise falls back to SMTP — see OtpDeliveryService's original
 * comment: Render's free instances block outbound SMTP ports, so Resend is
 * required there, while SMTP still works for local dev.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend?: Resend;
  private readonly transporter?: nodemailer.Transporter;
  private readonly mailFrom?: string;

  constructor(private config: ConfigService) {
    const resendApiKey = this.config.get<string>('RESEND_API_KEY');

    const transport = (this.config.get<string>('MAIL_TRANSPORT') ?? 'auto').toLowerCase();
    const useResend = transport === 'resend' || (transport === 'auto' && !!resendApiKey);

    this.mailFrom = useResend
      ? this.config.get<string>('MAIL_FROM') ?? this.config.get<string>('SMTP_FROM')
      : this.config.get<string>('SMTP_FROM') ?? this.config.get<string>('MAIL_FROM');

    if (useResend) {
      if (!resendApiKey) {
        this.logger.warn('MAIL_TRANSPORT=resend but RESEND_API_KEY is not set — falling back to SMTP.');
      } else {
        this.resend = new Resend(resendApiKey);
        this.logger.log('Email transport: Resend (HTTPS API)');
        return;
      }
    }

    const port = Number(this.config.get<string>('SMTP_PORT'));
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port,
      secure: port === 465,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
    this.logger.log(
      `Email transport: SMTP (${this.config.get<string>('SMTP_HOST')}:${port}) as ${this.mailFrom}`,
    );
  }

  /** Throws on failure — callers decide whether that should be fatal. */
  async send(to: string, subject: string, body: { text?: string; html?: string }) {
    if (!this.mailFrom) {
      throw new Error('No sender configured — set MAIL_FROM (or SMTP_FROM)');
    }

    if (this.resend) {
      if (!body.html && !body.text) {
        throw new Error('Mail body must have text or html');
      }
      // The Resend SDK's types require exactly one of text/html/react, so
      // body can't be spread as a plain object with both left optional.
      const payload = body.html
        ? { from: this.mailFrom, to, subject, html: body.html }
        : { from: this.mailFrom, to, subject, text: body.text! };
      // The Resend SDK resolves with { data, error } instead of rejecting,
      // so a failed send looks like success unless error is checked.
      const { error } = await this.resend.emails.send(payload);
      if (error) {
        throw new Error(`Resend rejected the message: ${error.name} — ${error.message}`);
      }
      return;
    }

    if (!this.transporter) {
      throw new Error('No email transport configured — set RESEND_API_KEY or SMTP_*');
    }
    await this.transporter.sendMail({ from: this.mailFrom, to, subject, text: body.text, html: body.html });
  }
}
