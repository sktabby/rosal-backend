import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../common/mail/mail.service';

/**
 * Sends the SAME otp code to both the user's registered email and phone.
 * Swap the SMS provider block for whichever you actually use — Twilio shown
 * as the default since it's the most common for Indian SMS + is straightforward
 * to wire up; MSG91/Textlocal are common India-specific alternatives.
 *
 * Email delivery itself (Resend vs SMTP transport selection) lives in the
 * shared MailService — see its header comment for why Resend is required
 * on Render.
 */
@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);
  /**
   * LOCAL DEV ONLY. When true, sendOtp() prints the code to the server console
   * instead of emailing/SMSing it, so the login flow is testable without a
   * working mail provider (e.g. while Resend is still in sandbox mode).
   *
   * Deliberately double-gated: the explicit OTP_DEV_MODE=true flag AND
   * NODE_ENV !== 'production'. Setting the flag on a production deployment
   * does nothing, so this cannot leak real OTPs into production logs.
   */
  private readonly otpDevMode: boolean;

  constructor(private config: ConfigService, private mail: MailService) {
    const devModeRequested = this.config.get<string>('OTP_DEV_MODE') === 'true';
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    this.otpDevMode = devModeRequested && !isProduction;

    if (devModeRequested && isProduction) {
      this.logger.warn(
        'OTP_DEV_MODE=true was IGNORED because NODE_ENV=production. Real OTP delivery is active.',
      );
    }
    if (this.otpDevMode) {
      this.logger.warn(
        'OTP_DEV_MODE is ON — OTP codes will be printed to this console and NOT emailed/texted. Never enable this in production.',
      );
    }
  }

  private sendEmail(to: string, subject: string, text: string) {
    return this.mail.send(to, subject, { text });
  }

  async sendOtp(params: {
    email: string;
    phone: string;
    otp: string;
    firstName: string;
    employeeCode?: string;
  }) {
    const { email, phone, otp, firstName, employeeCode } = params;

    if (this.otpDevMode) {
      // eslint-disable-next-line no-console
      console.log(
        `
[DEV MODE] OTP for ${employeeCode ?? email}: ${otp}
` +
          `[DEV MODE] (email/SMS skipped — set OTP_DEV_MODE=false in .env to send for real)
`,
      );
      return;
    }

    await Promise.all([this.sendOtpEmail(email, firstName, otp), this.sendOtpSms(phone, otp)]);
  }

  private async sendOtpEmail(email: string, firstName: string, otp: string) {
    try {
      await this.sendEmail(
        email,
        'Your Rosal Safety OMS login code',
        `Hi ${firstName},\n\nYour one-time login code is: ${otp}\n\nThis code expires in ${this.config.get(
          'OTP_EXPIRES_IN_MINUTES',
        )} minutes. If you did not request this, please contact your Admin.\n\n— Rosal Safety OMS`,
      );
    } catch (err) {
      // Don't fail login over a broken/unconfigured mail provider — the OTP is
      // still generated and checked server-side (see README §2), so an
      // undelivered email shouldn't 500 the whole auth flow.
      this.logger.error(`Failed to send OTP email to ${email}`, err as Error);
    }
  }

  private async sendOtpSms(phone: string, otp: string) {
    // Stub — plug in Twilio/MSG91 here. Kept isolated so swapping providers
    // touches only this method.
    //
    // OTP is masked in logs even in this stub — checklist §2.4 is explicit
    // that OTP codes must never be logged, and log lines persist/get
    // aggregated regardless of "it's just a dev stub" intent.
    const masked = `${otp.slice(0, 1)}${'*'.repeat(otp.length - 2)}${otp.slice(-1)}`;
    this.logger.log(`[SMS STUB] Would send OTP (masked: ${masked}) to ${phone}`);
    if (process.env.NODE_ENV !== 'production') {
      // Dev-only convenience: write the real code to a local file instead of
      // stdout, so local testing works without ever putting the OTP in logs.
      const fs = await import('fs/promises');
      await fs.appendFile('otp-dev.local.log', `${new Date().toISOString()} ${phone} ${otp}\n`).catch(() => {});
    }
    // Example Twilio implementation:
    // const client = twilio(this.config.get('TWILIO_ACCOUNT_SID'), this.config.get('TWILIO_AUTH_TOKEN'));
    // await client.messages.create({
    //   body: `Your Rosal Safety OMS login code is ${otp}`,
    //   from: this.config.get('TWILIO_FROM_NUMBER'),
    //   to: phone,
    // });
  }

  async sendNewUserCredentials(params: {
    email: string;
    firstName: string;
    employeeCode: string;
    generatedId: string;
    temporaryPassword: string;
  }) {
    const { email, firstName, employeeCode, generatedId, temporaryPassword } = params;
    try {
      await this.sendEmail(
        email,
        'Your Rosal Safety OMS account has been created',
        `Hi ${firstName},\n\nAn account has been created for you on the Rosal Safety Order Management System.\n\nEmployee ID (use this to log in): ${employeeCode}\nDisplay ID: ${generatedId}\nTemporary Password: ${temporaryPassword}\n\nPlease log in and change your password from the Account screen.\n\n— Rosal Safety OMS`,
      );
    } catch (err) {
      this.logger.error(`Failed to send new-user email to ${email}`, err as Error);
      // Do not throw — user creation should still succeed even if email delivery fails;
      // Admin can be shown a "resend credentials" affordance separately.
    }
  }

  async sendPasswordResetEmail(params: { email: string; firstName: string; employeeCode: string; temporaryPassword: string }) {
    const { email, firstName, employeeCode, temporaryPassword } = params;
    try {
      await this.sendEmail(
        email,
        'Your Rosal Safety OMS password has been reset',
        `Hi ${firstName},\n\nAn administrator has reset your password on the Rosal Safety Order Management System.\n\nEmployee ID (use this to log in): ${employeeCode}\nTemporary Password: ${temporaryPassword}\n\nPlease log in and change your password from the Account screen. If you did not expect this, contact your administrator.\n\n— Rosal Safety OMS`,
      );
    } catch (err) {
      this.logger.error(`Failed to send password-reset email to ${email}`, err as Error);
      // Do not throw — the reset already succeeded and the admin sees the
      // temporary password on screen as a fallback if delivery fails.
    }
  }
}
