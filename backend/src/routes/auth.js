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
const {validateProfile}=require('../student-profile');

const router = express.Router();
const RESET_MINUTES = 10;     // how long a code works
const RESET_TRIES = 5;        // guesses allowed per code
const RESEND_SECONDS = 30;    // wait before another code can be requested

// Keep useful diagnostics without logging recipients, codes, secrets or SMTP payloads.
const deliveryFailure = error => ({
  code:typeof error?.code==='string' && /^[A-Z0-9_]{1,48}$/.test(error.code)?error.code:'UNKNOWN',
  relayStatus:Number.isInteger(error?.relayStatus)&&error.relayStatus>=100&&error.relayStatus<=599?error.relayStatus:null
});

// Slows down people who keep guessing. Switched off by RATE_LIMIT=off (used by the test script only).
const limiter = (max, minutes) => process.env.RATE_LIMIT === 'off'
  ? (req, res, next) => next()
  : rateLimit({ windowMs: minutes * 60e3, limit: max, standardHeaders: true, legacyHeaders: false,
      message: { error: 'Too many tries. Please wait a few minutes and try again.' } });

// Channel/recipient binding invalidates pre-switch Gmail codes without a schema change.
const hashCode = (code,email) => crypto.createHmac('sha256', SECRET).update('pup-webmail-reset-v1:'+v.normEmail(email)+':'+code).digest('hex');
const sameText = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', 10);   // so a wrong username takes as long as a wrong password

const WEBMAIL_MSG = 'Use your PUP web mail (@iskolarngbayan.pup.edu.ph for students, @pup.edu.ph for faculty).';
const PHONE_MSG = 'Enter a valid Philippine mobile number, like 09XXXXXXXXX.';

// ---- Student / Faculty registration ----
router.post('/register', limiter(20, 15), wrap(async (req, res) => {
  const { email, phone, password, courseCode, section } = req.body || {};
  const kind = v.emailKind(email);
  if (!kind) throw new HttpError(400, WEBMAIL_MSG);
  if (!v.validPhone(phone)) throw new HttpError(400, PHONE_MSG);
  const problem = v.passwordProblem(password);
  if (problem) throw new HttpError(400, problem);
  const profile=kind==='student'?validateProfile(courseCode,section):null;
  const id = await createUser({
    profile, role: 'viewer', email: v.normEmail(email), kind, phone: v.normPhone(phone),
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

// Course/section belong to students; login still uses the same PUP account.
router.get('/me/student-profile',requireAuth,wrap(async(req,res)=>{
  try {
    const [[profile]]=await pool.query('SELECT course_code AS courseCode,section FROM student_profiles WHERE user_id=?',[req.user.id]);
    res.json({profile:profile || null});
  } catch(e) {if(e.code==='ER_NO_SUCH_TABLE')return res.json({profile:null});throw e;}
}));
router.put('/me/student-profile',requireAuth,wrap(async(req,res)=>{
  if(req.user.role!=='viewer'||req.user.email_kind!=='student')throw new HttpError(403,'Student accounts only.');
  const profile=validateProfile(req.body?.courseCode,req.body?.section);
  try {
  await pool.query('INSERT INTO student_profiles (user_id,course_code,section) VALUES (?,?,?) ON DUPLICATE KEY UPDATE course_code=VALUES(course_code),section=VALUES(section)',[req.user.id,profile.courseCode,profile.section]);
  } catch(e) {if(e.code==='ER_NO_SUCH_TABLE')throw new HttpError(503,'Install student profile migration 09 first.');throw e;}
  res.json({profile});
}));

// A delivery-only test to the currently registered PUP address, never a caller-selected recipient.
const webmailTestLimit=process.env.RATE_LIMIT==='off'?(req,res,next)=>next():rateLimit({windowMs:15*60000,limit:3,keyGenerator:req=>String(req.user.id),standardHeaders:true,legacyHeaders:false,message:{error:'Please wait before requesting another webmail test.'}});
router.post('/me/test-webmail',requireAuth,webmailTestLimit,wrap(async(req,res)=>{
  const email=v.normEmail(req.user.email);
  if(!v.emailKind(email))throw new HttpError(400,'Your account needs a registered PUP webmail address.');
  try { await mail.sendWebmailTest(email); }
  catch(e) {
    console.error('PUP webmail test failed:',JSON.stringify({code:e.code || 'UNKNOWN',relayStatus:e.relayStatus || null}));
    throw new HttpError(503,'Could not send the webmail test. Please try again after the email service deployment is ready.');
  }
  res.json({ok:true,message:'Test email accepted. Check your registered PUP Outlook Inbox and Junk folder.'});
}));

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
const lastRequest = new Map();      // normalized login identifier -> cooldown
function resetIdentity(body) {
  const id=String(body?.identifier ?? body?.email ?? '').trim();
  if(id.length>254)throw new HttpError(400,'Enter your username or registered mobile number.');
  if(id.includes('@')){
    if(!v.emailKind(id))throw new HttpError(400,'Enter your PUP web mail.');
    return {column:'email',value:v.normEmail(id)};
  }
  if(/^[+\d\s-]+$/.test(id)&&v.validPhone(id))return {column:'phone',value:v.normPhone(id)};
  if(v.validUsername(v.normUsername(id))&&!/^[+\d\s-]+$/.test(id))return {column:'username',value:v.normUsername(id)};
  throw new HttpError(400,'Enter your username or registered mobile number.');
}

router.post('/forgot', limiter(10, 15), wrap(async (req, res) => {
  const identity=resetIdentity(req.body);
  const requestKey=identity.column+':'+identity.value;

  const wait = Math.ceil(((lastRequest.get(requestKey) || 0) + RESEND_SECONDS * 1000 - Date.now()) / 1000);
  if (wait > 0) throw new HttpError(429, `Please wait ${wait} seconds before asking for a new code.`);
  try {
    await mail.ensureDeliveryAvailable();
  } catch (e) {
    console.error('Password reset email unavailable:', JSON.stringify(deliveryFailure(e)));
    throw new HttpError(503, 'Password reset email is temporarily unavailable. Please contact your administrator or try again later.');
  }
  lastRequest.set(requestKey, Date.now());
  if (lastRequest.size > 5000) for (const [k, t] of lastRequest) if (Date.now() - t > 3600e3) lastRequest.delete(k);

  // Always give the same response; never reveal whether the PUP address is registered.
  const reply = { ok: true, message: 'If this account is registered, a password reset code has been requested for its PUP webmail.' };
  let u;
  const code = String(crypto.randomInt(100000, 1000000));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(`SELECT id,email FROM users WHERE ${identity.column}=? AND is_active=1 FOR UPDATE`,[identity.value]);
    u=rows[0];
    if (u) {
      await conn.query('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL',[u.id]);
      await conn.query('INSERT INTO password_resets (user_id,code_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL ? MINUTE))',[u.id,hashCode(code,u.email),RESET_MINUTES]);
    }
    await conn.commit();
  } catch(e) { await conn.rollback();throw e; } finally {conn.release();}
  if (!u) return res.json(reply);

  // Send in the background so the reply is just as fast whether or not the account exists.
  mail.sendResetCode(u.email, code, RESET_MINUTES)
    .then(r => pool.query('INSERT INTO notification_log (purpose, channel, to_address, user_id, status) VALUES (?, ?, ?, ?, ?)',
      ['password_reset', 'email', u.email, u.id, r.sent ? 'sent' : 'queued']).catch(e=>{console.error('Could not record reset email status:',JSON.stringify(deliveryFailure(e)));}))
    .catch(async e => {
      const failure=JSON.stringify(deliveryFailure(e));
      console.error('Could not send the reset email:', failure);
      await pool.query('INSERT INTO notification_log (purpose, channel, to_address, user_id, status, error) VALUES (?, ?, ?, ?, ?, ?)',
        ['password_reset', 'email', u.email, u.id, 'failed', failure]).catch(() => {});
    });
  res.json(reply);
}));

router.post('/verify-code', limiter(30, 15), wrap(async (req, res) => {
  const identity=resetIdentity(req.body);
  const code = String(req.body && req.body.code != null ? req.body.code : '').trim();
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the 6-digit code.');
  const bad = new HttpError(400, 'That code is not correct or has expired. Send a new code.');

  const [rows] = await pool.query(
    `SELECT r.id, r.code_hash, r.user_id, u.email AS reset_email FROM password_resets r JOIN users u ON u.id = r.user_id
     WHERE u.${identity.column} = ? AND u.is_active = 1 AND r.used_at IS NULL AND r.verified_at IS NULL AND r.expires_at > NOW()
     ORDER BY r.id DESC LIMIT 1`, [identity.value]);
  const r = rows[0];
  if (!r) throw bad;
  const email=r.reset_email;

  // Use up one try first (in one step), so fast parallel guessing cannot get more than 5 tries.
  const [claim] = await pool.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ? AND attempts < ?', [r.id, RESET_TRIES]);
  if (claim.affectedRows !== 1) throw bad;
  if (!sameText(hashCode(code,email), r.code_hash)) throw bad;

  await pool.query('UPDATE password_resets SET verified_at = NOW() WHERE id = ?', [r.id]);
  const resetToken = jwt.sign({ purpose: 'reset', channel:'pup-webmail', emailHash:sha(email), rid: r.id, sub: r.user_id }, SECRET, { algorithm: 'HS256', expiresIn: RESET_MINUTES + 'm' });
  res.json({ resetToken });
}));

router.post('/reset', limiter(15, 15), wrap(async (req, res) => {
  const { resetToken, newPassword } = req.body || {};
  const expired = new HttpError(400, 'This reset has expired. Please start again.');
  let p;
  try { p = jwt.verify(String(resetToken || ''), SECRET, { algorithms: ['HS256'] }); } catch (e) { throw expired; }
  if (p.purpose !== 'reset' || p.channel !== 'pup-webmail') throw expired;
  const problem = v.passwordProblem(newPassword);
  if (problem) throw new HttpError(400, problem);
  const hash = await bcrypt.hash(newPassword, 10);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Bind the grant to the current active account email, even if it changed after verification.
    const [[account]]=await conn.query('SELECT email FROM users WHERE id=? AND is_active=1 FOR UPDATE',[p.sub]);
    if(!account || !sameText(sha(v.normEmail(account.email)),p.emailHash))throw expired;
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
