// Creating accounts. A new account also gets an entry in the SMS list so it can receive alerts.
const { pool } = require('./db');
const { HttpError } = require('./http');

function dupMessage(err) {
  if (err && err.code === 'ER_DUP_ENTRY') {
    const m = err.sqlMessage || '';
    if (m.includes('uq_users_email')) return 'This web mail is already registered.';
    if (m.includes('uq_users_phone')) return 'This mobile number is already registered.';
    if (m.includes('uq_users_username')) return 'That username is taken. Try another.';
  }
  return null;
}

async function createUser({ role, username, fullName, email, kind, phone, passwordHash }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      'INSERT INTO users (role, username, full_name, email, email_kind, phone, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [role, username || null, fullName || null, email, kind, phone, passwordHash]);
    const smsRole = role === 'admin' ? 'Admin' : kind === 'faculty' ? 'Faculty' : 'Student';
    const [ex] = await conn.query('SELECT id, role FROM sms_recipients WHERE phone = ? FOR UPDATE', [phone]);
    if (ex[0]) {
      await conn.query('UPDATE sms_recipients SET user_id = ?, role = ? WHERE id = ?', [r.insertId, role === 'admin' ? 'Admin' : ex[0].role, ex[0].id]);
    } else {
      await conn.query('INSERT INTO sms_recipients (name, role, phone, sms_enabled, user_id) VALUES (?, ?, ?, 1, ?)',
        [fullName || 'Unnamed user', smsRole, phone, r.insertId]);
    }
    await conn.commit();
    return r.insertId;
  } catch (e) {
    await conn.rollback();
    const m = dupMessage(e);
    if (m) throw new HttpError(409, m);
    throw e;
  } finally {
    conn.release();
  }
}

async function getUser(id) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports = { createUser, getUser, dupMessage };
