// Sends the password reset code by email.
//  - SMTP_HOST filled in .env  -> a real email is sent (Brevo, SendGrid, Gmail SMTP, ...).
//  - SMTP_HOST empty           -> the code is printed in the terminal (for testing only).
const nodemailer = require('nodemailer');

let transport = null;
if (process.env.SMTP_HOST) {
  const port = Number(process.env.SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

// Remembers the last code per address, only while testing. Not kept in production.
const lastCodes = new Map();

async function sendResetCode(to, code, minutes) {
  if (process.env.NODE_ENV !== 'production') lastCodes.set(to, code);

  if (!transport) {
    if (process.env.NODE_ENV === 'production') throw new Error('SMTP is not set up, so email cannot be sent.');
    console.log(`\n[TEST MODE] No SMTP set. Password reset code for ${to}: ${code}\n`);
    return { sent: false, testMode: true };
  }

  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: 'Your SafeZone password reset code',
    text: `Your SafeZone code is ${code}.\n\nIt works for ${minutes} minutes. If you did not ask to reset your password, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px">
      <h2 style="color:#7A1235;margin:0 0 8px">SafeZone</h2>
      <p>Your password reset code is:</p>
      <p style="font-size:30px;letter-spacing:6px;font-weight:bold;margin:8px 0">${code}</p>
      <p>It works for ${minutes} minutes. If you did not ask to reset your password, you can ignore this email.</p></div>`
  });
  return { sent: true, testMode: false };
}

module.exports = { sendResetCode, lastCodes };
