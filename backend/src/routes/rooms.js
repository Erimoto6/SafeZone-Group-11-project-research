// Rooms. Numbers follow the floor: 1st = 101-199, 2nd = 201-299, 3rd = 301-399, 4th = 401-499.
const express = require('express');
const { pool } = require('../db');
const { HttpError, wrap } = require('../http');
const { requireAuth, requireAdmin } = require('../auth');
const inventory = require('../room-devices');

const router = express.Router();
const MAX_FLOOR = Number(process.env.MAX_FLOOR) || 4;
const DEVICES = ['esp32', 'temp_sensor', 'hum_sensor', 'co2_sensor', 'fan', 'wifi', 'sms_module', 'power_meter'];

const roomJson = (r, devices = []) => ({
  id: r.id, name: 'Room ' + r.room_no, floor: r.floor_no, roomNo: r.room_no,
  lights: r.lights, wattsPerLight: r.watts_per_light, fanWatts: r.fan_watts,
  ventMode: r.vent_mode, deviceId: r.device_id, devices
});

router.get('/', requireAuth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM rooms WHERE room_no NOT IN (108,205,210,307,309) ORDER BY floor_no, room_no');
  const devices = await inventory.load(pool);
  res.json({ rooms: rows.map(r => roomJson(r, devices.get(r.id) || [])) });
}));

router.post('/', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const floor = Number(b.floor), roomNo = Number(b.roomNo);
  const lights = 0;
  const wattsPerLight = b.wattsPerLight == null ? 18 : Number(b.wattsPerLight);
  const fanWatts = b.fanWatts == null ? 40 : Number(b.fanWatts);

  if (!Number.isInteger(floor) || floor < 1 || floor > MAX_FLOOR) throw new HttpError(400, `Floor must be from 1 to ${MAX_FLOOR}.`);
  const lo = floor * 100 + 1, hi = floor * 100 + 99;
  if (!Number.isInteger(roomNo) || roomNo < lo || roomNo > hi) {
    throw new HttpError(400, `Floor ${floor} rooms are numbered ${lo}, ${lo + 1}, ${lo + 2} and so on, up to ${hi}.`);
  }
  if (b.lights && Number(b.lights) !== 0) throw new HttpError(400, 'Lighting is not supported.');
  if ([108,205,210,307,309].includes(roomNo)) throw new HttpError(400, 'That room is not a classroom.');
  if (!Number.isInteger(lights) || lights < 0 || lights > 100) throw new HttpError(400, 'Lights: enter a number from 0 to 100.');
  if (!(wattsPerLight > 0 && wattsPerLight <= 500)) throw new HttpError(400, 'Watts per light: enter a number from 1 to 500.');
  if (!(fanWatts >= 0 && fanWatts <= 2000)) throw new HttpError(400, 'Fan watts: enter a number from 0 to 2000.');
  const devices = inventory.validate(b.devices ?? [
    ...(fanWatts ? [{type:'exhaust_fan',label:'Exhaust fan',quantity:1,wattsPerDevice:fanWatts,fanType:'unspecified'}] : [])
  ]);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query('INSERT INTO rooms (floor_no, room_no, lights, watts_per_light, fan_watts) VALUES (?, ?, ?, ?, ?)',
      [floor, roomNo, lights, wattsPerLight, fanWatts]);
    await conn.query('INSERT INTO device_status (room_id, device) VALUES ?', [DEVICES.map(d => [r.insertId, d])]);
    await inventory.replace(conn, r.insertId, devices);
    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM rooms WHERE id = ?', [r.insertId]);
    res.status(201).json({ room: roomJson(rows[0], devices) });
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, `Room ${roomNo} already exists.`);
    throw e;
  } finally {
    conn.release();
  }
}));

// Edit room information, device groups or the shared exhaust fan mode.
router.patch('/:id', requireAdmin, wrap(async (req, res) => {
  const b=req.body || {}, id=Number(req.params.id);
  if (!Number.isSafeInteger(id) || id<1) throw new HttpError(400,'Choose a valid room.');
  if (b.ventMode!==undefined && !['auto','manual'].includes(b.ventMode)) throw new HttpError(400,"ventMode must be 'auto' or 'manual'.");
  const devices=b.devices===undefined?null:inventory.validate(b.devices);
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[room]]=await conn.query('SELECT * FROM rooms WHERE room_no NOT IN (108,205,210,307,309) AND id=? FOR UPDATE',[id]);
    if (!room) throw new HttpError(404,'Room not found.');
    const floor=b.floor===undefined?room.floor_no:Number(b.floor), no=b.roomNo===undefined?room.room_no:Number(b.roomNo);
    if (!Number.isInteger(floor)||floor<1||floor>MAX_FLOOR||!Number.isInteger(no)||no<floor*100+1||no>floor*100+99) throw new HttpError(400,'Room number must match its selected floor.');
    if ([108,205,210,307,309].includes(no)) throw new HttpError(400, 'That room is not a classroom.');
    if (!Object.keys(b).some(k=>['floor','roomNo','ventMode','devices'].includes(k))) throw new HttpError(400,'Choose room information to update.');
    await conn.query('UPDATE rooms SET floor_no=?,room_no=?,vent_mode=? WHERE id=?',[floor,no,b.ventMode??room.vent_mode,id]);
    if (devices) await inventory.replace(conn,id,devices);
    await conn.commit();
    const [[fresh]]=await conn.query('SELECT * FROM rooms WHERE room_no NOT IN (108,205,210,307,309) AND id=?',[id]);
    const all=await inventory.load(conn);
    res.json({room:roomJson(fresh,all.get(id)||[])});
  } catch(e) {
    await conn.rollback();
    if (e.code==='ER_DUP_ENTRY') throw new HttpError(409,'That room number already exists.');
    throw e;
  } finally {conn.release();}
}));

router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rooms]=await conn.query('SELECT id FROM rooms WHERE room_no NOT IN (108,205,210,307,309) ORDER BY id FOR UPDATE');
    if(rooms.length<=1)throw new HttpError(400,'Keep at least one room.');
    const [r]=await conn.query('DELETE FROM rooms WHERE room_no NOT IN (108,205,210,307,309) AND id=?',[Number(req.params.id)]);
    if(!r.affectedRows)throw new HttpError(404,'Room not found.');
    await conn.commit();res.json({ok:true});
  } catch(e){await conn.rollback();throw e;} finally {conn.release();}
}));

module.exports = router;
