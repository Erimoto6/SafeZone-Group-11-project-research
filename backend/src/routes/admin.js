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
  const [rows] = await pool.query("SELECT * FROM users WHERE is_active = 1 OR (role = 'viewer' AND email_kind = 'student') ORDER BY role, id");
  let profiles=[];
  try { [profiles]=await pool.query('SELECT user_id,course_code,section FROM student_profiles'); } catch(e) {if(e.code!=='ER_NO_SUCH_TABLE')throw e;}
  const byId=new Map(profiles.map(p=>[p.user_id,p]));
  res.json({
    admins: rows.filter(u => u.role === 'admin').map(publicUser),
    viewers: rows.filter(u => u.role === 'viewer').map(u=>({...publicUser(u),courseCode:byId.get(u.id)?.course_code || null,section:byId.get(u.id)?.section || null}))
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

// Permanently delete a student account and release its registration details.
router.delete('/users/:id', wrap(async (req, res) => {
  const id=Number(req.params.id);
  if (!Number.isSafeInteger(id) || id<1) throw new HttpError(400,'Choose a valid student account.');
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[student]]=await conn.query('SELECT id,role,email_kind,is_active FROM users WHERE id=? FOR UPDATE',[id]);
    if (!student) throw new HttpError(404,'Student account not found.');
    if (student.role!=='viewer' || student.email_kind!=='student') throw new HttpError(400,'Only student accounts can be removed here.');
    await conn.query('DELETE FROM sms_recipients WHERE user_id=?',[id]);
    // Foreign keys cascade recovery addresses/reset codes and detach history.
    await conn.query('DELETE FROM users WHERE id=?',[id]);
    await conn.commit();
    res.json({ok:true});
  } catch(e) { await conn.rollback();throw e; } finally {conn.release();}
}));

module.exports = router;
