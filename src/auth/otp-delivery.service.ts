import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Sends the SAME otp code to both the user's registered email and phone.
 * Swap the SMS provider block for whichever you actually use — Twilio shown
 * as the default since it's the most common for Indian SMS + is straightforward
 * to wire up; MSG91/Textlocal are common India-specific alternatives.
 */
@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: Number(this.config.get<string>('SMTP_PORT')),
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendOtp(params: { email: string; phone: string; otp: string; firstName: string }) {
    const { email, phone, otp, firstName } = params;

    await Promise.all([this.sendOtpEmail(email, firstName, otp), this.sendOtpSms(phone, otp)]);
  }

  private async sendOtpEmail(email: string, firstName: string, otp: string) {
    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM'),
        to: email,
        subject: 'Your Rosal Safety OMS login code',
        text: `Hi ${firstName},\n\nYour one-time login code is: ${otp}\n\nThis code expires in ${this.config.get(
          'OTP_EXPIRES_IN_MINUTES',
        )} minutes. If you did not request this, please contact your Admin.\n\n— Rosal Safety OMS`,
      });
    } catch (err) {
      this.logger.error(`Failed to send OTP email to ${email}`, err as Error);
      throw err;
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
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM'),
        to: email,
        subject: 'Your Rosal Safety OMS account has been created',
        text: `Hi ${firstName},\n\nAn account has been created for you on the Rosal Safety Order Management System.\n\nEmployee ID (use this to log in): ${employeeCode}\nDisplay ID: ${generatedId}\nTemporary Password: ${temporaryPassword}\n\nPlease log in and change your password from the Account screen.\n\n— Rosal Safety OMS`,
      });
    } catch (err) {
      this.logger.error(`Failed to send new-user email to ${email}`, err as Error);
      // Do not throw — user creation should still succeed even if email delivery fails;
      // Admin can be shown a "resend credentials" affordance separately.
    }
  }
}
