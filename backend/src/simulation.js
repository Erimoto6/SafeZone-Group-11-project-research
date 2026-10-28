// Shared demo state lives in MySQL. Only the server advances it, even with no phones open.
const { pool } = require('./db');
const { HttpError } = require('./http');
const inventory = require('./room-devices');
const KEYS = ['temp', 'hum', 'co2'];
const BASE = { temp: 27.4, hum: 58, co2: 827 };
const COOLED = { temp: 26, hum: 54, co2: 600 };
const LABELS = { temp: 'Temperature', hum: 'Humidity', co2: 'CO₂' };
const rank = { normal: 0, warning: 1, exceeded: 2 };
const level = (value, t) => value >= t.limit ? 'exceeded' : value >= t.warn ? 'warning' : 'normal';

async function seed(conn) {
  await conn.query('INSERT IGNORE INTO simulation_state (room_id) SELECT id FROM rooms');
  await conn.query('INSERT IGNORE INTO electricity_usage (room_id) SELECT id FROM rooms');
}
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_NO_SUCH_TABLE') throw new HttpError(503, 'Install the database migrations 04, 05 and 06 from the database folder first.');
    throw e;
  } finally { conn.release(); }
}
async function read() {
  return transaction(async conn => {
    await seed(conn);
    const [rows] = await conn.query(`SELECT s.*, r.vent_mode,r.room_no,r.floor_no,r.lights,r.watts_per_light,r.fan_watts,
      e.lights_kwh,e.fan_kwh,e.operating_ms FROM simulation_state s JOIN rooms r ON r.id=s.room_id
      JOIN electricity_usage e ON e.room_id=s.room_id WHERE r.room_no NOT IN (108,205,210,307,309) ORDER BY s.room_id`);
    const [limits] = await conn.query('SELECT metric,warn_value,limit_value FROM thresholds');
    const groups = await inventory.load(conn);
    const [[setting]] = await conn.query("SELECT setting_value FROM settings WHERE setting_key='fan_trigger'");
    return { source: 'simulation',
      thresholds: Object.fromEntries(limits.map(t => [t.metric, { warn: Number(t.warn_value), limit: Number(t.limit_value) }])),
      fanTrigger: setting?.setting_value || 'exceeded', rooms: rows.map(s => ({
      id: s.room_id, name: 'Room ' + s.room_no, floor: s.floor_no,
      lights: s.lights, wattsPerLight: s.watts_per_light, fanWatts: s.fan_watts,
      devices: groups.get(s.room_id) || [],
      lightsOn: groups.has(s.room_id) ? inventory.totals(groups.get(s.room_id)).lightsOn : Math.round(s.lights*0.75),
      reading: { temp: s.temp, hum: s.hum, co2: s.co2 },
      electricity: { lightsKwh: s.lights_kwh, fanKwh: s.fan_kwh, totalKwh: s.fan_kwh, operatingMs: Number(s.operating_ms) },
      levels: { temp: s.temp_level, hum: s.hum_level, co2: s.co2_level },
      fanOn: !!s.fan_on, ventMode: s.vent_mode, scenario: s.scenario,
      updatedAt: new Date(s.last_step_at).getTime()
    })) };
  });
}
async function control({ metric, roomIds, allRooms, fanOn }) {
  if (!['temp', 'hum', 'co2', 'reset', 'fan'].includes(metric)) throw new HttpError(400, 'Choose temperature, humidity, CO₂ or reset.');
  if (allRooms !== undefined && typeof allRooms !== 'boolean') throw new HttpError(400, 'allRooms must be true or false.');
  if (metric === 'fan' && typeof fanOn !== 'boolean') throw new HttpError(400, 'fanOn must be true or false.');
  if (!allRooms && (!Array.isArray(roomIds) || !roomIds.length || roomIds.length > 500 || roomIds.some(id => !Number.isSafeInteger(id) || id < 1))) {
    throw new HttpError(400, 'Select at least one valid room.');
  }
  return transaction(async conn => {
    await seed(conn);
    const [rooms] = await conn.query('SELECT id FROM rooms WHERE room_no NOT IN (108,205,210,307,309) ORDER BY id FOR UPDATE');
    const ids = allRooms ? rooms.map(r => r.id) : [...new Set(roomIds)];
    if (!ids.length || ids.some(id => !rooms.some(r => r.id === id))) throw new HttpError(400, 'One or more selected rooms no longer exist.');
    if (metric === 'reset') {
      await conn.query(`UPDATE simulation_state SET temp=?,hum=?,co2=?,scenario=NULL,start_value=NULL,fan_on=0,
        temp_level='normal',hum_level='normal',co2_level='normal',last_step_at=NOW(3) WHERE room_id IN (?)`, [BASE.temp, BASE.hum, BASE.co2, ids]);
    } else if (metric === 'fan') {
      await conn.query('UPDATE rooms SET vent_mode=\'manual\' WHERE id IN (?)', [ids]);
      await conn.query('UPDATE simulation_state SET fan_on=? WHERE room_id IN (?)', [fanOn, ids]);
    } else {
      // metric is validated above; all values remain parameterized.
      await conn.query(`UPDATE simulation_state SET scenario=?,start_value=\`${metric}\`,last_step_at=NOW(3) WHERE room_id IN (?)`, [metric, ids]);
    }
    return { ok: true, affectedRoomIds: ids };
  });
}
async function advance(now = Date.now(), startedAt = now - 2000) {
  return transaction(async conn => {
    await seed(conn);
    const [limits] = await conn.query('SELECT metric,warn_value,limit_value FROM thresholds');
    const thresholds = Object.fromEntries(limits.map(t => [t.metric, { warn: Number(t.warn_value), limit: Number(t.limit_value) }]));
    if (KEYS.some(k => !thresholds[k] || thresholds[k].warn >= thresholds[k].limit)) throw new Error('Configure valid thresholds for all three metrics.');
    const [[setting]] = await conn.query("SELECT setting_value FROM settings WHERE setting_key='fan_trigger'");
    const need = setting?.setting_value === 'warning' ? 1 : 2;
    // Row locks and last_step_at prevent two backend workers advancing the same interval twice.
    const [states] = await conn.query('SELECT s.*,r.vent_mode,r.room_no,r.lights,r.watts_per_light,r.fan_watts FROM simulation_state s JOIN rooms r ON r.id=s.room_id WHERE r.room_no NOT IN (108,205,210,307,309) ORDER BY s.room_id FOR UPDATE');
    const groups = await inventory.load(conn);
    for (const s of states) {
      if (now - new Date(s.last_step_at).getTime() < 2000) continue;
      const previousWorst = Math.max(...KEYS.map(k => rank[s[k + '_level']]));
      const oldFan = !!s.fan_on;
      // W * milliseconds / 3,600,000,000 = kWh. Never charge for server downtime.
      const elapsedMs = Math.max(0, Math.min(now - new Date(s.last_step_at).getTime(), now - startedAt));
      const rated = groups.has(s.room_id) ? inventory.totals(groups.get(s.room_id)) : {
        activeLightWatts: 0, fanWatts:s.fan_watts
      };
      await conn.query('UPDATE electricity_usage SET lights_kwh=lights_kwh+?,fan_kwh=fan_kwh+?,operating_ms=operating_ms+? WHERE room_id=?',
        [0, (oldFan ? rated.fanWatts : 0) * elapsedMs / 3600000000, elapsedMs, s.room_id]);
      const events = [];
      for (const k of KEYS) {
        const t = thresholds[k];
        if (s.scenario === k && !s.fan_on) {
          const normal = s[k] < t.warn;
          const step = (normal ? Math.max(t.warn - s.start_value, t.limit - t.warn) : t.limit - t.warn) / 6;
          const ceiling = normal ? t.warn : t.limit;
          const epsilon = Number.EPSILON * Math.max(1, Math.abs(ceiling)) * 16;
          s[k] = ceiling - s[k] <= step + epsilon ? ceiling : s[k] + step;
          // Finish a single demo run at the limit, then recover on later ticks.
          if (s[k] >= t.limit) s.scenario = null;
        } else {
          const target = s.fan_on ? Math.min(COOLED[k], t.warn - (t.limit - t.warn) / 2) : BASE[k];
          s[k] += (target - s[k]) * 0.18;
        }
        const next = level(s[k], t);
        if (rank[next] > rank[s[k + '_level']]) events.push({ type: next, metric: k, value: s[k],
          title: next === 'warning' ? `${LABELS[k]} Near Limit` : `High ${LABELS[k]} Level`,
          body: `${LABELS[k]} reached ${s[k].toFixed(k === 'temp' ? 1 : 0)}. Warning: ${t.warn}; limit: ${t.limit}. No SMS was sent.` });
        s[k + '_level'] = next;
      }
      const worst = Math.max(...KEYS.map(k => rank[s[k + '_level']]));
      if (s.vent_mode === 'auto') {
        if (worst >= need) s.fan_on = 1;
        else if (worst === 0) { s.fan_on = 0; if (oldFan) s.scenario = null; }
      }
      if (!!s.fan_on !== oldFan) events.push({ type: 'ventilation', title: s.fan_on ? 'Ventilation Activated' : 'Ventilation Stopped', body: 'Shared demo fan state changed. No hardware command was sent.' });
      if (worst === 0 && previousWorst > 0) events.push({ type: 'normal', title: 'System Normal', body: 'All shared demo readings are back within the configured limits.' });
      for (const e of events) await conn.query(`INSERT INTO alerts (room_id,type,title,body,metric,reading_value,sms_sent) VALUES (?,?,?,?,?,?,0)`,
        [s.room_id,e.type,'Demo: ' + e.title,e.body,e.metric || null,e.value ?? null]);
      await conn.query(`UPDATE simulation_state SET temp=?,hum=?,co2=?,scenario=?,fan_on=?,temp_level=?,hum_level=?,co2_level=?,last_step_at=? WHERE room_id=?`,
        [s.temp,s.hum,s.co2,s.scenario,s.fan_on,s.temp_level,s.hum_level,s.co2_level,new Date(now),s.room_id]);
    }
  });
}
function start() {
  let busy = false;
  const startedAt = Date.now();
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await advance(Date.now(), startedAt); } catch (e) { console.error('Shared simulation:', e.message); }
    finally { busy = false; }
  }, 2000);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = { read, control, advance, start };
