const { HttpError } = require('./http');
const TYPES = ['exhaust_fan','esp8266','temp_sensor','hum_sensor','co2_sensor','wifi','sms_module','power_meter'];
const FAN_TYPES = ['unspecified','wall','window','ceiling','inline'];
function validate(devices) {
  if (!Array.isArray(devices) || devices.length > 50) throw new HttpError(400, 'Use at most 50 device groups per room.');
  const clean = devices.map(d => {
    if (!d || !TYPES.includes(d.type)) throw new HttpError(400, 'Choose a valid device type.');
    const quantity = Number(d.quantity), activeQuantity = d.activeQuantity == null ? quantity : Number(d.activeQuantity);
    const label = String(d.label || '').trim(), watts = Number(d.wattsPerDevice ?? 0);
    if (!label || label.length > 100) throw new HttpError(400, 'Each device needs a name of up to 100 characters.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new HttpError(400, 'Device quantity must be from 1 to 100.');
    if (!Number.isInteger(activeQuantity) || activeQuantity < 0 || activeQuantity > quantity) throw new HttpError(400, 'Active quantity must be between zero and the quantity.');
    const powered = d.type === 'exhaust_fan';
    if (powered && (!Number.isFinite(watts) || watts <= 0 || watts > 2000)) throw new HttpError(400, 'Device wattage must be greater than zero and at most 2000 W.');
    const fanType = d.type === 'exhaust_fan' ? d.fanType || 'unspecified' : null;
    if (fanType && !FAN_TYPES.includes(fanType)) throw new HttpError(400, 'Choose a valid exhaust fan type.');
    return { type:d.type,label,quantity,activeQuantity:0,wattsPerDevice:powered?watts:0,fanType };
  });
  if (totals(clean).fanWatts>99999.9) throw new HttpError(400,'Total exhaust fan rating must not exceed 99999.9 W.');
  return clean;
}
const json = d => ({ id:d.id,type:d.device_type === 'esp32' ? 'esp8266' : d.device_type,label:d.device_type === 'esp32' && /esp32/i.test(d.label) ? d.label.replace(/ESP32(?: controller)?/ig, 'NodeMCU V3 ESP8266') : d.label,quantity:d.quantity,activeQuantity:d.active_quantity,wattsPerDevice:d.watts_per_device,fanType:d.fan_type });
async function load(conn) {
  const [rows] = await conn.query("SELECT * FROM room_devices WHERE device_type <> 'light' ORDER BY room_id,id");
  const groups = new Map();
  for (const row of rows) { if (!groups.has(row.room_id)) groups.set(row.room_id,[]); groups.get(row.room_id).push(json(row)); }
  return groups;
}
function totals(devices) {
  return devices.reduce((t,d) => {
    if (d.type==='exhaust_fan') { t.fans+=d.quantity; t.fanWatts+=d.quantity*d.wattsPerDevice; }
    return t;
  },{lights:0,lightsOn:0,lightWatts:0,activeLightWatts:0,fans:0,fanWatts:0});
}
async function replace(conn, roomId, devices) {
  await conn.query("DELETE FROM room_devices WHERE room_id=? AND device_type <> 'light'",[roomId]);
  for (const d of devices) await conn.query('INSERT INTO room_devices (room_id,device_type,label,quantity,active_quantity,watts_per_device,fan_type) VALUES (?,?,?,?,?,?,?)',
    [roomId,d.type,d.label,d.quantity,d.activeQuantity,d.wattsPerDevice,d.fanType]);
  const t=totals(devices);
  await conn.query('UPDATE rooms SET lights=?,watts_per_light=?,fan_watts=? WHERE id=?',[t.lights,t.lights?t.lightWatts/t.lights:18,t.fanWatts,roomId]);
}
module.exports = { validate,load,replace,totals };
