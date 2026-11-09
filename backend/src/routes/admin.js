// Admin-only: see all accounts and add another admin.
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { HttpError, wrap } = require('../http');
const v = require('../validate');
const { requireAdmin, publicUser } = require('../auth');
const { createUser, getUser } = require('../users');

const router = express.Router();
router.use(requireAdmin);

router.get('/users', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM users WHERE is_active = 1 ORDER BY role, id');
  res.json({
    admins: rows.filter(u => u.role === 'admin').map(publicUser),
    viewers: rows.filter(u => u.role === 'viewer').map(publicUser)
  });
}));

// "Add another admin": an existing admin gives someone else admin access.
router.post('/users', wrap(async (req, res) => {
  const { fullName, username, email, phone, password } = req.body || {};
  const name = v.cleanName(fullName), user = v.normUsername(username);
  if (name.length < 2 || name.length > 100) throw new HttpError(400, "Enter the new admin's full name.");
  if (!v.validUsername(user)) throw new HttpError(400, 'Username: 3 to 20 letters, numbers, dots, dashes or underscores.');
  const kind = v.emailKind(email);
  if (!kind) throw new HttpError(400, 'Use a PUP web mail (@iskolarngbayan.pup.edu.ph or @pup.edu.ph).');
  if (!v.validPhone(phone)) throw new HttpError(400, 'Enter a valid Philippine mobile number, like 09XXXXXXXXX.');
  const problem = v.passwordProblem(password);
  if (problem) throw new HttpError(400, problem);
  const id = await createUser({
    role: 'admin', username: user, fullName: name, email: v.normEmail(email), kind, phone: v.normPhone(phone),
    passwordHash: await bcrypt.hash(password, 10)
  });
  res.status(201).json({ user: publicUser(await getUser(id)) });
}));

// Remove student access without deleting historical records.
router.delete('/users/:id', wrap(async (req, res) => {
  const id=Number(req.params.id);
  if (!Number.isSafeInteger(id) || id<1) throw new HttpError(400,'Choose a valid student account.');
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[student]]=await conn.query('SELECT id,role,email_kind,is_active FROM users WHERE id=? FOR UPDATE',[id]);
    if (!student || !student.is_active) throw new HttpError(404,'Student account not found.');
    if (student.role!=='viewer' || student.email_kind!=='student') throw new HttpError(400,'Only student accounts can be removed here.');
    await conn.query('UPDATE users SET is_active=0,token_version=token_version+1 WHERE id=?',[id]);
    await conn.query('UPDATE sms_recipients SET sms_enabled=0 WHERE user_id=?',[id]);
    await conn.query('DELETE FROM password_resets WHERE user_id=? AND used_at IS NULL',[id]);
    await conn.commit();
    res.json({ok:true});
  } catch(e) { await conn.rollback();throw e; } finally {conn.release();}
}));

module.exports = router;
