// A logged-in user verifies ownership before Gmail becomes their recovery address.
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { requireAuth, SECRET } = require('../auth');
const { HttpError, wrap } = require('../http');
const mail = require('../mail');
const { normEmail, validRecoveryGmail } = require('../validate');
const router = express.Router();
router.use(requireAuth);
const limit = process.env.RATE_LIMIT === 'off' ? (req,res,next)=>next() : rateLimit({windowMs:15*60000,limit:20,standardHeaders:true,legacyHeaders:false});
const hashCode = (id,email,code) => crypto.createHmac('sha256',SECRET).update(`recovery:${id}:${email}:${code}`).digest('hex');
router.get('/',wrap(async(req,res)=>{
  const [[row]] = await pool.query('SELECT email,pending_email,expires_at > NOW() AS valid FROM account_recovery WHERE user_id=?',[req.user.id]);
  res.json({email:row?.email || null,pendingEmail:row?.valid ? row.pending_email : null});
}));
router.post('/request',limit,wrap(async(req,res)=>{
  const email=normEmail(req.body?.email);
  if (!validRecoveryGmail(email)) throw new HttpError(400,'Enter a Gmail address ending in @gmail.com.');
  if (!await bcrypt.compare(String(req.body?.currentPassword || ''),req.user.password_hash)) throw new HttpError(400,'Your current password is not correct.');
  try { await mail.ensureDeliveryAvailable(); } catch { throw new HttpError(503,'Email delivery is unavailable. Please try again later.'); }
  const code=String(crypto.randomInt(100000,1000000)), hash=hashCode(req.user.id,email,code);
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT IGNORE INTO account_recovery (user_id) VALUES (?)',[req.user.id]);
    const [[row]]=await conn.query('SELECT TIMESTAMPDIFF(SECOND,requested_at,NOW()) AS elapsed FROM account_recovery WHERE user_id=? FOR UPDATE',[req.user.id]);
    if (row.elapsed !== null && row.elapsed<30) throw new HttpError(429,'Please wait 30 seconds before requesting another code.');
    await conn.query('UPDATE account_recovery SET pending_email=?,code_hash=?,attempts=0,requested_at=NOW(3),expires_at=DATE_ADD(NOW(3),INTERVAL 10 MINUTE) WHERE user_id=?',[email,hash,req.user.id]);
    await conn.commit();
  } catch(e) { await conn.rollback();throw e; } finally { conn.release(); }
  try { await mail.sendResetCode(email,code,10,'recovery'); }
  catch(e) {
    await pool.query('UPDATE account_recovery SET pending_email=NULL,code_hash=NULL,expires_at=NULL WHERE user_id=? AND code_hash=?',[req.user.id,hash]);
    console.error('Recovery verification email failed:',e.message);
    throw new HttpError(503,'Could not send the verification email. Please try again later.');
  }
  res.json({ok:true,pendingEmail:email});
}));
router.post('/verify',limit,wrap(async(req,res)=>{
  const code=String(req.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) throw new HttpError(400,'Enter the six-digit verification code.');
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]]=await conn.query('SELECT *,expires_at > NOW() AS valid FROM account_recovery WHERE user_id=? FOR UPDATE',[req.user.id]);
    if (!row?.valid || !row.code_hash || row.attempts>=5) throw new HttpError(400,'That code has expired or reached its attempt limit. Request a new code.');
    const candidate=hashCode(req.user.id,row.pending_email,code);
    if (!crypto.timingSafeEqual(Buffer.from(candidate),Buffer.from(row.code_hash))) {
      await conn.query('UPDATE account_recovery SET attempts=attempts+1 WHERE user_id=?',[req.user.id]);
      await conn.commit();
      throw new HttpError(400,'That verification code is not correct.');
    }
    await conn.query('UPDATE account_recovery SET email=pending_email,pending_email=NULL,code_hash=NULL,expires_at=NULL,attempts=0 WHERE user_id=?',[req.user.id]);
    // Codes sent to a previous recovery address must no longer reset this account.
    await conn.query('DELETE FROM password_resets WHERE user_id=? AND used_at IS NULL',[req.user.id]);
    await conn.commit();
    res.json({ok:true,email:row.pending_email});
  } catch(e) { await conn.rollback();throw e; } finally {conn.release();}
}));
module.exports=router;
