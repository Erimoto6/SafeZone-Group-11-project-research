// Thresholds (warning and limit), when the fan starts, and automatic/manual mode.
const express = require('express');
const { pool } = require('../db');
const { HttpError, wrap } = require('../http');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();
const METRICS = ['temp', 'hum', 'co2'];

async function readSettings() {
  const [t] = await pool.query('SELECT metric, warn_value, limit_value FROM thresholds');
  const thresholds = {};
  for (const row of t) thresholds[row.metric] = { warn: row.warn_value, limit: row.limit_value };
  const [s] = await pool.query("SELECT setting_value FROM settings WHERE setting_key = 'fan_trigger'");
  const [m] = await pool.query("SELECT SUM(vent_mode = 'auto') AS auto_n, COUNT(*) AS total FROM rooms WHERE room_no NOT IN (108,205,210,307,309)");
  const [[sms]] = await pool.query('SELECT COUNT(*) AS n FROM sms_recipients WHERE sms_enabled = 1');
  return { thresholds, fanTrigger: s[0] ? s[0].setting_value : 'exceeded', ventMode: m[0].total && Number(m[0].auto_n) === m[0].total ? 'auto' : 'manual', smsEnabledCount: sms.n };
}

router.get('/', requireAuth, wrap(async (req, res) => res.json(await readSettings())));

router.put('/', requireAdmin, wrap(async (req, res) => {
  const { thresholds, fanTrigger, ventMode } = req.body || {};
  if (thresholds != null) {
    for (const k of METRICS) {
      const t = thresholds[k];
      if (!t || !Number.isFinite(Number(t.warn)) || !Number.isFinite(Number(t.limit))) throw new HttpError(400, `Enter numbers for ${k}.`);
      if (Number(t.warn) >= Number(t.limit)) throw new HttpError(400, `${k}: the warning must be lower than the limit.`);
    }
  }
  if (fanTrigger != null && !['warning', 'exceeded'].includes(fanTrigger)) throw new HttpError(400, "fanTrigger must be 'warning' or 'exceeded'.");
  if (ventMode != null && !['auto', 'manual'].includes(ventMode)) throw new HttpError(400, "ventMode must be 'auto' or 'manual'.");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (thresholds != null) {
      for (const k of METRICS) {
        await conn.query('UPDATE thresholds SET warn_value = ?, limit_value = ?, updated_by = ? WHERE metric = ?',
          [Number(thresholds[k].warn), Number(thresholds[k].limit), req.user.id, k]);
      }
    }
    if (fanTrigger != null) {
      await conn.query("INSERT INTO settings (setting_key, setting_value) VALUES ('fan_trigger', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)", [fanTrigger]);
    }
    if (ventMode != null) await conn.query('UPDATE rooms SET vent_mode = ?', [ventMode]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  res.json(await readSettings());
}));

module.exports = router;
