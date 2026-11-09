// Run only against a disposable database with all migrations installed.
require('dotenv').config({ quiet: true });
if (process.env.SAFEZONE_TEST_DB !== '1') throw new Error('Use a disposable database and set SAFEZONE_TEST_DB=1.');
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const simulation = require('../src/simulation');
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
let roomId;
(async () => {
  const [states] = await pool.query('SELECT * FROM simulation_state');
  const [usage] = await pool.query('SELECT * FROM electricity_usage');
  const [[mark]] = await pool.query('SELECT COALESCE(MAX(id),0) AS id FROM alerts');
  try {
    const [rooms] = await pool.query('SELECT room_no FROM rooms');
    const number = Array.from({ length: 99 }, (_, i) => 401 + i).find(n => !rooms.some(r => r.room_no === n));
    assert(number);
    const [created] = await pool.query("INSERT INTO rooms (floor_no,room_no,lights,watts_per_light,fan_watts,vent_mode) VALUES (4,?,4,25,80,'manual')", [number]);
    roomId = created.insertId;
    await simulation.control({ metric: 'reset', roomIds: [roomId] });
    const energy = async () => (await simulation.read()).rooms.find(r => r.id === roomId).electricity;
    const hour = 3600000;
    let now = Date.now();
    await pool.query('UPDATE simulation_state SET last_step_at=? WHERE room_id=?', [new Date(now - hour),roomId]);
    await simulation.advance(now, now - hour);
    let e = await energy();
    close(e.lightsKwh, 0); // Legacy light ratings no longer accrue energy.
    close(e.fanKwh, 0);
    await simulation.control({ metric: 'fan', roomIds: [roomId], fanOn: true });
    now += hour;
    await simulation.advance(now, now - hour);
    e = await energy();
    close(e.lightsKwh, 0); close(e.fanKwh, 0.08); close(e.totalKwh, 0.08);
    assert.deepEqual(e, await energy(), 'reads must not accumulate more usage');
    await simulation.control({ metric: 'reset', roomIds: [roomId] });
    assert.deepEqual(e, await energy(), 'resetting readings must preserve accumulated energy');
    await pool.query('UPDATE simulation_state SET last_step_at=? WHERE room_id=?', [new Date(now - 24 * hour),roomId]);
    await simulation.advance(now + 2000, now);
    e = await energy();
    close(e.totalKwh, 0.08);
    assert.equal(e.operatingMs, 2 * hour + 2000, 'server downtime must be excluded');
    await simulation.advance(now + 2000, now);
    assert.deepEqual(e, await energy(), 'duplicate worker tick must not double-count');
    const inventory=require('../src/room-devices');
    const groups=inventory.validate([
      {type:'exhaust_fan',label:'Window fans',quantity:2,wattsPerDevice:60,fanType:'window'}
    ]);
    assert.throws(()=>inventory.validate([{type:'light',label:'Bad',quantity:1,activeQuantity:2,wattsPerDevice:10}]));
    await inventory.replace(pool,roomId,groups);
    await simulation.control({metric:'fan',roomIds:[roomId],fanOn:true});
    const before=await energy();now+=hour;
    await pool.query('UPDATE simulation_state SET last_step_at=? WHERE room_id=?',[new Date(now-hour),roomId]);
    await simulation.advance(now,now-hour);
    e=await energy();close(e.lightsKwh-before.lightsKwh,0);close(e.fanKwh-before.fanKwh,0.12);
    console.log('PASS: kWh conversion, persistence, downtime exclusion, duplicate protection, legacy lighting exclusion and multiple exhaust fans');
  } finally {
    await pool.query("DELETE FROM alerts WHERE id>? AND title LIKE 'Demo: %'", [mark.id]);
    await pool.query('DELETE FROM electricity_usage');
    await pool.query('DELETE FROM simulation_state');
    for (const row of states) await pool.query('INSERT INTO simulation_state SET ?', [row]);
    for (const row of usage) await pool.query('INSERT INTO electricity_usage SET ?', [row]);
    if (roomId) await pool.query('DELETE FROM rooms WHERE id=?', [roomId]);
    await pool.end();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
