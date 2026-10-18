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

module.exports = router;
