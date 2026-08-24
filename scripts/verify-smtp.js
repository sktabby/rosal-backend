// Standalone SMTP credential check — run this locally before pasting SMTP_*
// values into Render, so a bad host/port/auth combo shows up here instead of
// as a 500 on /auth/login in production.
//
// Usage:
//   node scripts/verify-smtp.js                  connection/auth check only
//   node scripts/verify-smtp.js you@example.com   also sends a real test email
//
// Reads SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM from .env
// (same variables OtpDeliveryService uses), via the same secure-port rule.

require('dotenv/config');
const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM;

const missing = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'].filter(
  (key) => !process.env[key],
);
if (missing.length > 0) {
  console.error(`Missing env var(s): ${missing.join(', ')}. Fill these in your .env first.`);
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
});

async function main() {
  console.log(`Connecting to ${host}:${port} (secure=${port === 465}) as ${user}...`);
  await transporter.verify();
  console.log('Connection + auth OK.');

  const recipient = process.argv[2];
  if (!recipient) {
    console.log('No recipient given — skipping send. Pass an email address to send a real test message.');
    return;
  }

  const info = await transporter.sendMail({
    from,
    to: recipient,
    subject: 'Rosal Safety OMS — SMTP test',
    text: 'If you got this, SMTP delivery is working end-to-end.',
  });
  console.log(`Test email sent to ${recipient} (messageId: ${info.messageId}).`);
}

main().catch((err) => {
  console.error('SMTP check failed:', err.message || err);
  process.exit(1);
});
