// The Alerts list. The hardware / alert service adds alerts with the DEVICE_API_KEY.
const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { HttpError, wrap } = require('../http');
const { requireAuth } = require('../auth');

const router = express.Router();
const TYPES = ['normal', 'warning', 'exceeded', 'ventilation'];
const METRICS = ['temp', 'hum', 'co2'];

const cats = type => type === 'exceeded' ? ['exceeded', 'message'] : type === 'warning' ? ['message'] : ['system'];
const alertJson = r => ({
  id: r.id, roomId: r.room_id, room: r.room_no ? 'Room ' + r.room_no : null, type: r.type, title: r.title, body: r.body,
  metric: r.metric, value: r.reading_value, sms: r.sms_sent > 0, smsSent: r.sms_sent, cats: cats(r.type), ts: Number(r.ts)
});

router.get('/', requireAuth, wrap(async (req, res) => {
  const roomId = req.query.roomId ? Number(req.query.roomId) : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const [rows] = await pool.query(
    `SELECT a.*, r.room_no, UNIX_TIMESTAMP(a.created_at) * 1000 AS ts
     FROM alerts a LEFT JOIN rooms r ON r.id = a.room_id
     WHERE (? IS NULL OR a.room_id = ?) ORDER BY a.id DESC LIMIT ?`, [roomId, roomId, limit]);
  res.json({ alerts: rows.map(alertJson) });
}));

// Used by the future alert service (not by the app).
router.post('/', wrap(async (req, res) => {
  const key = process.env.DEVICE_API_KEY || '';
  const given = String(req.headers['x-api-key'] || '');
  const a = Buffer.from(given), b = Buffer.from(key);
  if (!key || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'Not allowed.');

  const { roomId, type, title, body, metric, value, smsSent } = req.body || {};
  if (!TYPES.includes(type)) throw new HttpError(400, 'Unknown alert type.');
  if (!title || String(title).length > 100 || !body || String(body).length > 255) throw new HttpError(400, 'Title and body are required.');
  if (metric != null && !METRICS.includes(metric)) throw new HttpError(400, 'Unknown metric.');
  const [r] = await pool.query(
    'INSERT INTO alerts (room_id, type, title, body, metric, reading_value, sms_sent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [roomId || null, type, String(title), String(body), metric || null, value == null ? null : Number(value), Number(smsSent) || 0]);
  res.status(201).json({ id: r.insertId });
}));

module.exports = router;
