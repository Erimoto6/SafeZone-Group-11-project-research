const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { pool } = require('./db');
const { HttpError, wrap } = require('./http');

const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);   // set this when the API sits behind a hosting proxy

app.use(helmet({ contentSecurityPolicy: { directives: {
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'https://fonts.gstatic.com'],
  'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null
} } }));

// Only these apps may call the API from a browser / WebView.
const allowed = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => cors({
  origin: (origin, cb) => (!origin || origin === `${req.protocol}://${req.get('host')}` || allowed.includes(origin)) ? cb(null, true) : cb(new HttpError(403, 'This app is not allowed to use the API.')),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
})(req, res, next));

app.use(express.json({ limit: '50kb' }));
if (process.env.RATE_LIMIT !== 'off') app.use(rateLimit({ windowMs: 60e3, limit: 300, standardHeaders: true, legacyHeaders: false }));

// Open this in the browser to check the API and the database are connected.
app.get('/api/health', wrap(async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const out = { ok: true, database: 'connected', time: new Date().toISOString() };
    if (process.env.NODE_ENV !== 'production') out.mail = process.env.SMTP_HOST ? 'smtp' : 'test-mode';   // test-mode = codes are printed in the backend terminal
    res.json(out);
  } catch (e) {
    res.status(503).json({ ok: false, database: 'not connected' });
  }
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/sms-recipients', require('./routes/sms'));
app.use('/api/alerts', require('./routes/alerts'));

// Serve the web app and API from one address during development and hosting.
app.use(express.static(require('path').join(__dirname, '../../www')));

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// Every error ends here. People see a clear message; details stay in the terminal.
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'That request was not valid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

module.exports = app;
