// SMS Alerts settings: who gets a text (name, role, mobile number), and who is switched on.
const express = require('express');
const { pool } = require('../db');
const { HttpError, wrap } = require('../http');
const v = require('../validate');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.use(requireAdmin);

const personJson = r => ({ id: r.id, name: r.name, role: r.role, phone: r.phone, smsEnabled: !!r.sms_enabled, userId: r.user_id });
const dup = e => { if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That number is already in the list.'); throw e; };

function readPerson(b, partial) {
  const out = {};
  if (!partial || b.name !== undefined) { out.name = v.cleanName(b.name); if (!out.name || out.name.length > 100) throw new HttpError(400, "Enter the person's name."); }
  if (!partial || b.role !== undefined) { out.role = v.cleanName(b.role); if (!out.role || out.role.length > 30) throw new HttpError(400, 'Choose their role.'); }
  if (!partial || b.phone !== undefined) { if (!v.validPhone(b.phone)) throw new HttpError(400, 'Enter a valid Philippine mobile number, like 09XXXXXXXXX.'); out.phone = v.normPhone(b.phone); }
  if (b.smsEnabled !== undefined) out.sms_enabled = b.smsEnabled ? 1 : 0;
  return out;
}

router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM sms_recipients ORDER BY id');
  res.json({ recipients: rows.map(personJson) });
}));

router.post('/', wrap(async (req, res) => {
  const p = readPerson(req.body || {}, false);
  try {
    const [r] = await pool.query('INSERT INTO sms_recipients (name, role, phone, sms_enabled) VALUES (?, ?, ?, 1)', [p.name, p.role, p.phone]);
    const [rows] = await pool.query('SELECT * FROM sms_recipients WHERE id = ?', [r.insertId]);
    res.status(201).json({ recipient: personJson(rows[0]) });
  } catch (e) { dup(e); }
}));

router.patch('/:id', wrap(async (req, res) => {
  const p = readPerson(req.body || {}, true);
  if (!Object.keys(p).length) throw new HttpError(400, 'Nothing to change.');
  try {
    const [r] = await pool.query('UPDATE sms_recipients SET ? WHERE id = ?', [p, Number(req.params.id)]);
    if (!r.affectedRows) throw new HttpError(404, 'Recipient not found.');
  } catch (e) { if (e instanceof HttpError) throw e; dup(e); }
  const [rows] = await pool.query('SELECT * FROM sms_recipients WHERE id = ?', [Number(req.params.id)]);
  res.json({ recipient: personJson(rows[0]) });
}));

router.delete('/:id', wrap(async (req, res) => {
  const [r] = await pool.query('DELETE FROM sms_recipients WHERE id = ?', [Number(req.params.id)]);
  if (!r.affectedRows) throw new HttpError(404, 'Recipient not found.');
  res.json({ ok: true });
}));

module.exports = router;
