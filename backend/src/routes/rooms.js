// Rooms. Numbers follow the floor: 1st = 101-199, 2nd = 201-299, 3rd = 301-399, 4th = 401-499.
const express = require('express');
const { pool } = require('../db');
const { HttpError, wrap } = require('../http');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();
const MAX_FLOOR = Number(process.env.MAX_FLOOR) || 4;
const DEVICES = ['esp32', 'temp_sensor', 'hum_sensor', 'co2_sensor', 'fan', 'wifi', 'sms_module', 'power_meter'];

const roomJson = r => ({
  id: r.id, name: 'Room ' + r.room_no, floor: r.floor_no, roomNo: r.room_no,
  lights: r.lights, wattsPerLight: r.watts_per_light, fanWatts: r.fan_watts,
  ventMode: r.vent_mode, deviceId: r.device_id
});

router.get('/', requireAuth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM rooms ORDER BY floor_no, room_no');
  res.json({ rooms: rows.map(roomJson) });
}));

router.post('/', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const floor = Number(b.floor), roomNo = Number(b.roomNo);
  const lights = b.lights == null ? 8 : Number(b.lights);
  const wattsPerLight = b.wattsPerLight == null ? 18 : Number(b.wattsPerLight);
  const fanWatts = b.fanWatts == null ? 40 : Number(b.fanWatts);

  if (!Number.isInteger(floor) || floor < 1 || floor > MAX_FLOOR) throw new HttpError(400, `Floor must be from 1 to ${MAX_FLOOR}.`);
  const lo = floor * 100 + 1, hi = floor * 100 + 99;
  if (!Number.isInteger(roomNo) || roomNo < lo || roomNo > hi) {
    throw new HttpError(400, `Floor ${floor} rooms are numbered ${lo}, ${lo + 1}, ${lo + 2} and so on, up to ${hi}.`);
  }
  if (!Number.isInteger(lights) || lights < 0 || lights > 100) throw new HttpError(400, 'Lights: enter a number from 0 to 100.');
  if (!(wattsPerLight > 0 && wattsPerLight <= 500)) throw new HttpError(400, 'Watts per light: enter a number from 1 to 500.');
  if (!(fanWatts >= 0 && fanWatts <= 2000)) throw new HttpError(400, 'Fan watts: enter a number from 0 to 2000.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query('INSERT INTO rooms (floor_no, room_no, lights, watts_per_light, fan_watts) VALUES (?, ?, ?, ?, ?)',
      [floor, roomNo, lights, wattsPerLight, fanWatts]);
    await conn.query('INSERT INTO device_status (room_id, device) VALUES ?', [DEVICES.map(d => [r.insertId, d])]);
    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM rooms WHERE id = ?', [r.insertId]);
    res.status(201).json({ room: roomJson(rows[0]) });
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, `Room ${roomNo} already exists.`);
    throw e;
  } finally {
    conn.release();
  }
}));

// Change one room's ventilation mode.
router.patch('/:id', requireAdmin, wrap(async (req, res) => {
  const mode = req.body && req.body.ventMode;
  if (!['auto', 'manual'].includes(mode)) throw new HttpError(400, "ventMode must be 'auto' or 'manual'.");
  const [r] = await pool.query('UPDATE rooms SET vent_mode = ? WHERE id = ?', [mode, Number(req.params.id)]);
  if (!r.affectedRows) throw new HttpError(404, 'Room not found.');
  const [rows] = await pool.query('SELECT * FROM rooms WHERE id = ?', [Number(req.params.id)]);
  res.json({ room: roomJson(rows[0]) });
}));

router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM rooms');
  if (count.n <= 1) throw new HttpError(400, 'Keep at least one room.');
  const [r] = await pool.query('DELETE FROM rooms WHERE id = ?', [Number(req.params.id)]);
  if (!r.affectedRows) throw new HttpError(404, 'Room not found.');
  res.json({ ok: true });
}));

module.exports = router;
