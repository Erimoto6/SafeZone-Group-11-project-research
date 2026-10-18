// Register, log in, forgot password, change password.
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { HttpError, wrap } = require('../http');
const v = require('../validate');
const { SECRET, sign, publicUser, requireAuth } = require('../auth');
const { createUser, getUser, dupMessage } = require('../users');
const mail = require('../mail');

const router = express.Router();
const RESET_MINUTES = 10;     // how long a code works
const RESET_TRIES = 5;        // guesses allowed per code
const RESEND_SECONDS = 30;    // wait before another code can be requested

// Slows down people who keep guessing. Switched off by RATE_LIMIT=off (used by the test script only).
const limiter = (max, minutes) => process.env.RATE_LIMIT === 'off'
  ? (req, res, next) => next()
  : rateLimit({ windowMs: minutes * 60e3, limit: max, standardHeaders: true, legacyHeaders: false,
      message: { error: 'Too many tries. Please wait a few minutes and try again.' } });

const hashCode = code => crypto.createHmac('sha256', SECRET).update(code).digest('hex');
const sameText = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', 10);   // so a wrong username takes as long as a wrong password

const WEBMAIL_MSG = 'Use your PUP web mail (@iskolarngbayan.pup.edu.ph for students, @pup.edu.ph for faculty).';
const PHONE_MSG = 'Enter a valid Philippine mobile number, like 09XXXXXXXXX.';

// ---- Student / Faculty registration ----
router.post('/register', limiter(20, 15), wrap(async (req, res) => {
  const { email, phone, password } = req.body || {};
  const kind = v.emailKind(email);
  if (!kind) throw new HttpError(400, WEBMAIL_MSG);
  if (!v.validPhone(phone)) throw new HttpError(400, PHONE_MSG);
  const problem = v.passwordProblem(password);
  if (problem) throw new HttpError(400, problem);
  const id = await createUser({
    role: 'viewer', email: v.normEmail(email), kind, phone: v.normPhone(phone),
    passwordHash: await bcrypt.hash(password, 10)
  });
  res.status(201).json({ user: publicUser(await getUser(id)) });
}));

// ---- Admin registration (needs the admin access code) ----
router.post('/register-admin', limiter(10, 15), wrap(async (req, res) => {
  const { fullName, username, email, phone, password, accessCode } = req.body || {};
  const expected = process.env.ADMIN_ACCESS_CODE || '';
  if (!expected || !sameText(sha(String(accessCode || '').toUpperCase()), sha(expected.toUpperCase()))) {
    throw new HttpError(403, 'Wrong admin access code.');
  }
  const name = v.cleanName(fullName), user = v.normUsername(username);
  if (name.length < 2 || name.length > 100) throw new HttpError(400, 'Enter your full name.');
  if (!v.validUsername(user)) throw new HttpError(400, 'Username: 3 to 20 letters, numbers, dots, dashes or underscores.');
  const kind = v.emailKind(email);
  if (!kind) throw new HttpError(400, WEBMAIL_MSG);
  if (!v.validPhone(phone)) throw new HttpError(400, PHONE_MSG);
  const problem = v.passwordProblem(password);
  if (problem) throw new HttpError(400, problem);
  const id = await createUser({
    role: 'admin', username: user, fullName: name, email: v.normEmail(email), kind, phone: v.normPhone(phone),
    passwordHash: await bcrypt.hash(password, 10)
  });
  res.status(201).json({ user: publicUser(await getUser(id)) });
}));

// ---- Log in. "identifier" can be a mobile number, a web mail, or an admin username. ----
router.post('/login', limiter(15, 15), wrap(async (req, res) => {
  const { identifier, password, as } = req.body || {};
  const id = String(identifier == null ? '' : identifier).trim();
  let rows;
  if (id.includes('@')) [rows] = await pool.query('SELECT * FROM users WHERE email = ? AND is_active = 1', [v.normEmail(id)]);
  else if (/^[+\d\s-]+$/.test(id)) [rows] = await pool.query('SELECT * FROM users WHERE phone = ? AND is_active = 1', [v.normPhone(id)]);
  else [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND is_active = 1', [v.normUsername(id)]);
  const u = rows[0];
  const passwordOk = await bcrypt.compare(String(password == null ? '' : password), u ? u.password_hash : DUMMY_HASH);
  const wrongSide = (as === 'admin' && u && u.role !== 'admin') || (as === 'viewer' && u && u.role !== 'viewer');
  if (!u || !passwordOk || wrongSide) throw new HttpError(401, 'Wrong login details. Check them and try again.');
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [u.id]);
  res.json({ token: sign(u), user: publicUser(u) });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// ---- Save or change my web mail ----
router.put('/me/email', requireAuth, wrap(async (req, res) => {
  const email = v.normEmail(req.body && req.body.email);
  const kind = v.emailKind(email);
  if (!kind) throw new HttpError(400, WEBMAIL_MSG);
  try { await pool.query('UPDATE users SET email = ?, email_kind = ? WHERE id = ?', [email, kind, req.user.id]); }
  catch (e) { const m = dupMessage(e); if (m) throw new HttpError(409, m); throw e; }
  res.json({ user: publicUser(await getUser(req.user.id)) });
}));

// ---- Change my password (needs the current one) ----
router.post('/change-password', requireAuth, limiter(10, 15), wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!(await bcrypt.compare(String(currentPassword || ''), req.user.password_hash))) throw new HttpError(401, 'Your current password is not correct.');
  const problem = v.passwordProblem(newPassword);
  if (problem) throw new HttpError(400, problem);
  await pool.query('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [await bcrypt.hash(newPassword, 10), req.user.id]);
  const fresh = await getUser(req.user.id);
  res.json({ ok: true, token: sign(fresh) });     // old logins stop working, this new token keeps you in
}));

// ---------------------------------------------------------------------------
// Forgot password: 1) forgot  2) verify-code  3) reset
// ---------------------------------------------------------------------------
const lastRequest = new Map();      // web mail -> time of the last request (cooldown)

router.post('/forgot', limiter(10, 15), wrap(async (req, res) => {
  const email = v.normEmail(req.body && req.body.email);
  if (!v.emailKind(email)) throw new HttpError(400, 'Enter your PUP web mail.');

  const wait = Math.ceil(((lastRequest.get(email) || 0) + RESEND_SECONDS * 1000 - Date.now()) / 1000);
  if (wait > 0) throw new HttpError(429, `Please wait ${wait} seconds before asking for a new code.`);
  lastRequest.set(email, Date.now());
  if (lastRequest.size > 5000) for (const [k, t] of lastRequest) if (Date.now() - t > 3600e3) lastRequest.delete(k);

  // The answer is always the same, so nobody can use this to find out who is registered.
  const reply = { ok: true, message: 'If that web mail is registered, we sent a 6-digit code to it.' };
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ? AND is_active = 1', [email]);
  const u = rows[0];
  if (!u) return res.json(reply);

  const code = String(crypto.randomInt(100000, 1000000));
  await pool.query('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', [u.id]);   // older codes stop working
  await pool.query('INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
    [u.id, hashCode(code), RESET_MINUTES]);

  // Send in the background so the reply is just as fast whether or not the account exists.
  mail.sendResetCode(email, code, RESET_MINUTES)
    .then(r => pool.query('INSERT INTO notification_log (purpose, channel, to_address, user_id, status) VALUES (?, ?, ?, ?, ?)',
      ['password_reset', 'email', email, u.id, r.sent ? 'sent' : 'queued']))
    .catch(async e => {
      console.error('Could not send the reset email:', e.message);
      await pool.query('INSERT INTO notification_log (purpose, channel, to_address, user_id, status, error) VALUES (?, ?, ?, ?, ?, ?)',
        ['password_reset', 'email', email, u.id, 'failed', String(e.message).slice(0, 255)]).catch(() => {});
    });
  res.json(reply);
}));

router.post('/verify-code', limiter(30, 15), wrap(async (req, res) => {
  const email = v.normEmail(req.body && req.body.email);
  const code = String(req.body && req.body.code != null ? req.body.code : '').trim();
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the 6-digit code.');
  const bad = new HttpError(400, 'That code is not correct or has expired. Send a new code.');

  const [rows] = await pool.query(
    `SELECT r.id, r.code_hash, r.user_id FROM password_resets r JOIN users u ON u.id = r.user_id
     WHERE u.email = ? AND r.used_at IS NULL AND r.verified_at IS NULL AND r.expires_at > NOW()
     ORDER BY r.id DESC LIMIT 1`, [email]);
  const r = rows[0];
  if (!r) throw bad;

  // Use up one try first (in one step), so fast parallel guessing cannot get more than 5 tries.
  const [claim] = await pool.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ? AND attempts < ?', [r.id, RESET_TRIES]);
  if (claim.affectedRows !== 1) throw bad;
  if (!sameText(hashCode(code), r.code_hash)) throw bad;

  await pool.query('UPDATE password_resets SET verified_at = NOW() WHERE id = ?', [r.id]);
  const resetToken = jwt.sign({ purpose: 'reset', rid: r.id, sub: r.user_id }, SECRET, { algorithm: 'HS256', expiresIn: RESET_MINUTES + 'm' });
  res.json({ resetToken });
}));

router.post('/reset', limiter(15, 15), wrap(async (req, res) => {
  const { resetToken, newPassword } = req.body || {};
  const expired = new HttpError(400, 'This reset has expired. Please start again.');
  let p;
  try { p = jwt.verify(String(resetToken || ''), SECRET, { algorithms: ['HS256'] }); } catch (e) { throw expired; }
  if (p.purpose !== 'reset') throw expired;
  const problem = v.passwordProblem(newPassword);
  if (problem) throw new HttpError(400, problem);
  const hash = await bcrypt.hash(newPassword, 10);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // The verified reset can be used exactly once.
    const [claim] = await conn.query(
      `UPDATE password_resets SET used_at = NOW()
       WHERE id = ? AND user_id = ? AND verified_at IS NOT NULL AND used_at IS NULL
         AND verified_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`, [p.rid, p.sub, RESET_MINUTES]);
    if (claim.affectedRows !== 1) { await conn.rollback(); throw expired; }
    await conn.query('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [hash, p.sub]);
    await conn.query('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', [p.sub]);
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* already rolled back */ }
    throw e;
  } finally {
    conn.release();
  }
  res.json({ ok: true });
}));

module.exports = router;
