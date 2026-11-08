// Isolated delivery probe. It cannot choose recipients or email content from a request.
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const sameSecret = (a, b) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(a).digest(),
  crypto.createHash('sha256').update(b).digest()
);
function createHandler({ env = process.env, createTransport = nodemailer.createTransport, log = console.error } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Use an authenticated POST request.' });
    }
    const secret = env.EMAIL_TEST_SECRET || '';
    if (secret.length < 32) return res.status(503).json({ error: 'Configure EMAIL_TEST_SECRET with at least 32 random characters.' });
    const header = req.headers.authorization || '';
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || !sameSecret(header.slice(7), secret)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    const user = (env.GMAIL_USER || '').trim().toLowerCase();
    const password = (env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
    const to = (env.EMAIL_TEST_TO || '').trim().toLowerCase();
    const address = /^[a-z0-9][a-z0-9._+\-]*@gmail\.com$/;
    if (!address.test(user) || !address.test(to) || !password) {
      return res.status(503).json({ error: 'Configure GMAIL_USER, GMAIL_APP_PASSWORD and EMAIL_TEST_TO (Gmail addresses only for this test).' });
    }
    const transport = createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user, pass: password },
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000
    });
    try {
      const result = await transport.sendMail({
        from: { name: 'SafeZone', address: user }, to,
        subject: 'SafeZone email delivery test',
        text: 'This is a SafeZone test email sent from Vercel through Gmail SMTP. It is not a password reset code. If you requested this test, receiving it confirms delivery to this inbox.'
      });
      if (!result.accepted?.some(value => String(value).toLowerCase() === to)) {
        return res.status(502).json({ error: 'Gmail did not accept the test recipient.' });
      }
      return res.status(200).json({ ok: true, message: 'Gmail accepted the test email. Check the configured recipient Inbox and Spam folder to confirm delivery.' });
    } catch (error) {
      // Do not log request headers, SMTP responses, passwords or recipient data.
      const code = ['EAUTH','ETIMEDOUT','ECONNECTION','ECONNREFUSED','ENOTFOUND','ESOCKET','EENVELOPE','EMESSAGE'].includes(error.code) ? error.code : 'SMTP_ERROR';
      log('SafeZone Vercel email test failed:', code);
      return res.status(502).json({ error: 'Email delivery test failed.', code });
    } finally { transport.close(); }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
