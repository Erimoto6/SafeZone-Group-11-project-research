// Login tokens (JWT) and the "who is calling?" checks used by the routes.
const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const { HttpError, wrap } = require('./http');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('\nJWT_SECRET in your .env file is missing or too short (use 32+ characters).');
  console.error('Make one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n');
  process.exit(1);
}

const publicUser = u => ({
  id: u.id, role: u.role, username: u.username, fullName: u.full_name,
  email: u.email, kind: u.email_kind, phone: u.phone,
  createdAt: u.created_at ? new Date(u.created_at).getTime() : null
});

const sign = u => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version }, SECRET,
  { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const requireAuth = wrap(async (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please log in.');
  let p;
  try { p = jwt.verify(token, SECRET, { algorithms: ['HS256'] }); }
  catch (e) { throw new HttpError(401, 'Your session has expired. Please log in again.'); }
  if (p.purpose) throw new HttpError(401, 'Please log in.');                 // a password-reset token is not a login
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ? AND is_active = 1', [p.sub]);
  const u = rows[0];
  if (!u || u.token_version !== p.tv) throw new HttpError(401, 'Your session has expired. Please log in again.');
  req.user = u;
  next();
});

const adminOnly = (req, res, next) =>
  req.user && req.user.role === 'admin' ? next() : next(new HttpError(403, 'Admins only.'));

const requireAdmin = [requireAuth, adminOnly];

module.exports = { SECRET, publicUser, sign, requireAuth, requireAdmin };
