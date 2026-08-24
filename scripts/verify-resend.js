// Standalone Resend credential check — run this before setting RESEND_API_KEY
// on Render, so a bad key or an unverified sender domain shows up here rather
// than as a silently undelivered OTP in production.
//
// Usage:
//   node scripts/verify-resend.js you@example.com
//
// Reads RESEND_API_KEY and MAIL_FROM (falling back to SMTP_FROM) from .env —
// the same variables OtpDeliveryService uses.
//
// NOTE on Resend's sending rules: until you verify a domain, you can only send
// FROM onboarding@resend.dev, and only TO the address your Resend account was
// created with. Sending to any other recipient fails until a domain is verified.

require('dotenv/config');
const { Resend } = require('resend');

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.MAIL_FROM || process.env.SMTP_FROM;
const to = process.argv[2];

if (!apiKey) {
  console.error('Missing RESEND_API_KEY. Add it to your .env first.');
  process.exit(1);
}
if (!from) {
  console.error('Missing MAIL_FROM (or SMTP_FROM). Add a sender address to your .env first.');
  process.exit(1);
}
if (!to) {
  console.error('Usage: node scripts/verify-resend.js <recipient@example.com>');
  process.exit(1);
}

const resend = new Resend(apiKey);

async function main() {
  console.log(`Sending via Resend from "${from}" to ${to}...`);

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: 'Rosal Safety OMS — Resend test',
    text: 'If you got this, Resend delivery is working end-to-end.',
  });

  if (error) {
    // The SDK resolves rather than rejects on API errors, so this must be
    // checked explicitly or a failure reads as success.
    console.error(`Resend rejected the message: ${error.name} — ${error.message}`);
    process.exit(1);
  }

  console.log(`Sent. Message id: ${data.id}`);
}

main().catch((err) => {
  console.error('Resend check failed:', err.message || err);
  process.exit(1);
});
