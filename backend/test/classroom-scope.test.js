const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const inventory = require('../src/room-devices');

test('roster includes 43 classrooms with correct floor counts and exclusions', () => {
  const source = fs.readFileSync(require.resolve('../../www/js/app.js'), 'utf8');
  const roster = vm.runInNewContext(source.slice(source.indexOf('const EXCLUDED_ROOMS'), source.indexOf('const ROOMS_V')) + '\nDEFAULT_ROOMS');
  assert.equal(roster.length, 43);
  assert.deepEqual([1,2,3,4].map(f => roster.filter(r => r.floor === f).length), [11,10,10,12]);
  for (const n of [108,205,210,307,309]) assert(!roster.some(r => r.name === 'Room '+n));
  const migration = fs.readFileSync(require.resolve('../../database/07-classroom-roster.sql'), 'utf8');
  for (const r of roster) assert(migration.includes(`(${r.floor},${r.name.slice(5)},0)`));
});

test('only fan groups contribute energy; lighting cannot be configured', () => {
  const fans = inventory.validate([{type:'exhaust_fan',label:'Fans',quantity:2,wattsPerDevice:60,fanType:'wall'}, {type:'esp8266',label:'NodeMCU V3 ESP8266',quantity:1}]);
  const totals = inventory.totals([...fans, {type:'light',quantity:8,activeQuantity:6,wattsPerDevice:18}]);
  assert.equal(totals.fanWatts, 120);
  assert.equal(totals.activeLightWatts, 0);
  assert.throws(() => inventory.validate([{type:'light',label:'Light',quantity:1,wattsPerDevice:18}]), /valid device type/);
});

test('legacy controller inventory displays ESP8266 and editing preserves lighting history', async () => {
  const queries = [];
  const conn = {query: async (sql, params) => {
    queries.push([sql, params]);
    return sql.startsWith('SELECT') ? [[{id:1,room_id:1,device_type:'esp32',label:'ESP32 Controller',quantity:1,active_quantity:0,watts_per_device:0}]] : [{}];
  }};
  const loaded = await inventory.load(conn);
  assert.equal(loaded.get(1)[0].type, 'esp8266');
  assert.equal(loaded.get(1)[0].label, 'NodeMCU V3 ESP8266');
  await inventory.replace(conn, 1, inventory.validate([{type:'exhaust_fan',label:'Fan',quantity:1,wattsPerDevice:40}]));
  assert(queries.find(([sql]) => sql.startsWith('DELETE')).at(0).includes("device_type <> 'light'"));
});
