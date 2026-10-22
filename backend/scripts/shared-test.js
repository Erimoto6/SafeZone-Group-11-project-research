// Integration tests use a disposable database and never send email.
require('dotenv').config({ quiet: true });
if (process.env.SAFEZONE_TEST_DB !== '1') throw new Error('Set SAFEZONE_TEST_DB=1 with a disposable database.');
process.env.RATE_LIMIT = 'off'; process.env.SMTP_HOST = ''; process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pool } = require('../src/db');
const simulation = require('../src/simulation');
const app = require('../src/app');
const tag = 'shared' + Date.now().toString(36), password = 'Testonly123';
const emails = [tag + '@pup.edu.ph', tag + '@iskolarngbayan.pup.edu.ph'];
const phones = ['096', '097'].map(p => p + String(Date.now()).slice(-8));
let server, browser, base, admin, student, now = Date.now();
const madeRooms = [];
async function call(path, method = 'GET', body, token) {
  const response = await fetch(base + '/api' + path, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function control(body) { const r = await call('/simulation', 'POST', body, admin); assert.equal(r.status, 200, JSON.stringify(r.body)); }
async function snapshot(token = student) { const r = await call('/simulation', 'GET', undefined, token); assert.equal(r.status, 200); return r.body.rooms; }
async function step(n) { for (let i = 0; i < n; i++) { now = Math.max(now, Date.now()) + 2500; await simulation.advance(now); } }
async function login(page, role, identifier) {
  await page.goto(base);
  await page.locator(`[data-act="role"][data-v="${role}"]`).click();
  if (role === 'student') await page.locator('[data-act="to"][data-v="vLogin"]').click();
  await page.locator(role === 'admin' ? '#u' : '#phone').fill(identifier);
  await page.locator('#pw').fill(password);
  await page.locator(role === 'admin' ? '#login-form button[type="submit"]' : '#v-login-form button[type="submit"]').click();
  await page.getByRole('button', { name: /Select room/ }).waitFor();
}
(async () => {
  const [thresholds] = await pool.query('SELECT * FROM thresholds');
  const [settings] = await pool.query("SELECT * FROM settings WHERE setting_key='fan_trigger'");
  const [modes] = await pool.query('SELECT id,vent_mode FROM rooms');
  const [originalState] = await pool.query('SELECT * FROM simulation_state');
  const [originalUsage] = await pool.query('SELECT * FROM electricity_usage');
  const [[alertMark]] = await pool.query('SELECT COALESCE(MAX(id),0) AS id FROM alerts');
  try {
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await call('/auth/register-admin', 'POST', { fullName: 'Shared Admin', username: tag, email: emails[0], phone: phones[0], password, accessCode: process.env.ADMIN_ACCESS_CODE })).status, 201);
    assert.equal((await call('/auth/register', 'POST', { email: emails[1], phone: phones[1], password })).status, 201);
    admin = (await call('/auth/login', 'POST', { identifier: tag, password })).body.token;
    student = (await call('/auth/login', 'POST', { identifier: phones[1], password })).body.token;
    const [existing] = await pool.query('SELECT room_no FROM rooms');
    const free = Array.from({ length: 99 }, (_, i) => 401 + i).filter(n => !existing.some(r => r.room_no === n)).slice(0, 3);
    assert.equal(free.length, 3);
    for (const roomNo of free) {
      const r = await call('/rooms', 'POST', { floor: 4, roomNo }, admin);
      assert.equal(r.status, 201); madeRooms.push(r.body.room.id);
    }
    assert.equal((await call('/simulation')).status, 401);
    assert.equal((await call('/simulation', 'POST', { metric: 'temp', allRooms: true }, student)).status, 403);
    for (const body of [{ metric: 'bad', allRooms: true }, { metric: 'temp', roomIds: [] }, { metric: 'temp', roomIds: [9999999] }, { metric: 'temp', roomIds: ['1'] }, { metric: 'temp', allRooms: 'yes' }]) {
      assert.equal((await call('/simulation', 'POST', body, admin)).status, 400);
    }
    console.log('PASS: authenticated reads, admin-only controls, invalid metric and room selection rejection');
    await call('/settings', 'PUT', { thresholds: { temp: { warn: 38, limit: 40 }, hum: { warn: 65, limit: 75 }, co2: { warn: 1000, limit: 1200 } }, fanTrigger: 'exceeded', ventMode: 'auto' }, admin);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
    const adminContext = await browser.newContext(), studentContext = await browser.newContext();
    await adminContext.addInitScript(()=>window.SAFEZONE_MODE='online');await studentContext.addInitScript(()=>window.SAFEZONE_MODE='online');
    const adminPage = await adminContext.newPage(), studentPage = await studentContext.newPage();
    const errors = []; for (const p of [adminPage, studentPage]) p.on('pageerror', e => errors.push(e.message));
    await studentPage.clock.install();
    await login(adminPage, 'admin', tag); await login(studentPage, 'student', phones[1]);
    await studentPage.locator('[data-act="go"][data-v="alerts"]').click();
    await studentPage.locator('[data-s="alerts"]').waitFor();
    await adminPage.locator('[data-act="go"][data-v="settings"]').click();
    await adminPage.locator('#sim-scope').selectOption('selected');
    for (const id of madeRooms.slice(0, 2)) await adminPage.locator(`.sim-room[value="${id}"]`).check();
    await adminPage.locator('[data-act="sim"][data-v="temp"]').click();
    await adminPage.waitForFunction(() => document.querySelector('#toast').textContent.startsWith('Shared simulation started'));
    let states = await snapshot();
    for (const id of madeRooms.slice(0, 2)) { const s = states.find(r => r.id === id); assert.equal(s.scenario, 'temp'); assert.equal(s.reading.temp, 27.4); }
    assert.equal(states.find(r => r.id === madeRooms[2]).scenario, null);
    await step(1); states = await snapshot();
    assert(states.find(r => r.id === madeRooms[0]).reading.temp > 27.4);
    assert(states.find(r => r.id === madeRooms[0]).reading.temp < 38);
    await step(5);
    const [[warning]] = await pool.query("SELECT COUNT(*) AS n FROM alerts WHERE room_id=? AND title='Demo: Temperature Near Limit'", [madeRooms[0]]);
    assert.equal(warning.n, 1);
    await step(7);
    // The student never triggers the simulation and must receive both room alerts by polling.
    const received = studentPage.waitForResponse(r => r.url().endsWith('/api/alerts') && r.status() === 200);
    await studentPage.clock.fastForward(2000); await received;
    await studentPage.getByText('Demo: High Temperature Level', { exact: true }).first().waitFor();
    assert.equal(await studentPage.getByText('Demo: High Temperature Level', { exact: true }).count(), 2);
    states = await snapshot();
    assert.deepEqual(states, await snapshot(admin));
    assert.equal(states.find(r => r.id === madeRooms[2]).reading.temp, 27.4);
    await studentPage.locator('[data-act="go"][data-v="home"]').first().click();
    await studentPage.getByRole('button', { name: /Select room/ }).click();
    await studentPage.locator(`[data-act="room"][data-v="${madeRooms[0]}"]`).click();
    assert((await studentPage.locator('.s-val').first().innerText()).includes(states.find(r => r.id === madeRooms[0]).reading.temp.toFixed(1)));
    await simulation.advance(now);
    const [[dangerCount]] = await pool.query("SELECT COUNT(*) AS n FROM alerts WHERE room_id=? AND title='Demo: High Temperature Level'", [madeRooms[0]]);
    assert.equal(dangerCount.n, 1, 'same tick must not duplicate alerts');
    await studentPage.reload();
    await studentPage.getByRole('button', { name: /Select room.*Room 101/ }).waitFor();
    await studentPage.locator('[data-act="go"][data-v="alerts"]').click();
    await studentPage.getByText('Demo: High Temperature Level', { exact: true }).first().waitFor();
    console.log('PASS: admin selects two rooms; separate student sees gradual readings and alerts without refreshing; unaffected third room and persistence after reload');
    for (const metric of ['co2', 'hum']) {
      await control({ metric: 'reset', roomIds: [madeRooms[2]] });
      await control({ metric, roomIds: [madeRooms[2]] }); await step(14);
      const [[event]] = await pool.query("SELECT COUNT(*) AS n FROM alerts WHERE room_id=? AND metric=? AND type='exceeded'", [madeRooms[2], metric]);
      assert.equal(event.n, 1);
    }
    await control({ metric: 'reset', roomIds: [madeRooms[2]] });
    await control({ metric: 'fan', roomIds: [madeRooms[2]], fanOn: false });
    await control({ metric: 'co2', roomIds: [madeRooms[2]] });
    await step(12);
    states = await snapshot();
    let manual = states.find(s => s.id === madeRooms[2]);
    assert.equal(manual.reading.co2, 1200);
    assert.equal(manual.scenario, null, 'a demo run must finish at its limit');
    await step(1);
    manual = (await snapshot()).find(s => s.id === madeRooms[2]);
    assert(manual.reading.co2 < 1200 && manual.reading.co2 > 827, 'manual mode must recover gradually instead of holding 1200 ppm');
    await call('/rooms/'+madeRooms[2], 'PATCH', { ventMode: 'auto' }, admin);
    console.log('PASS: manual fan-off simulation reaches danger and then gradually recovers');
    await control({ metric: 'reset', allRooms: true });
    await control({ metric: 'hum', allRooms: true });
    states = await snapshot(); assert(states.every(s => s.scenario === 'hum'));
    await control({ metric: 'reset', allRooms: true });
    states = await snapshot(); assert(states.every(s => s.scenario === null && s.reading.hum === 58));
    await call('/settings', 'PUT', { fanTrigger: 'warning' }, admin);
    await control({ metric: 'temp', roomIds: [madeRooms[2]] }); await step(6);
    states = await snapshot(); assert(states.find(s => s.id === madeRooms[2]).fanOn);
    await step(20);
    const [[prevented]] = await pool.query("SELECT COUNT(*) AS n FROM alerts WHERE room_id=? AND metric='temp' AND type='exceeded'", [madeRooms[2]]);
    assert.equal(prevented.n, 0);
    await control({ metric: 'reset', roomIds: [madeRooms[2]] });
    await control({ metric: 'co2', roomIds: [madeRooms[2]] });
    // Production starts this same worker without depending on connected clients.
    const stop = simulation.start();
    try { await new Promise(resolve => setTimeout(resolve, 2400)); } finally { stop(); }
    states = await snapshot();
    assert(states.find(s => s.id === madeRooms[2]).reading.co2 > 827);
    assert.deepEqual(states, (await require('../src/simulation').read()).rooms);
    assert.deepEqual(errors, []);
    console.log('PASS: CO2/humidity, all-room start/reset, warning-triggered cooling, no duplicate ticks and no browser errors');
    console.log('ALL SHARED SIMULATION CHECKS PASSED');
  } finally {
    if (browser) await browser.close();
    await pool.query('DELETE FROM alerts WHERE id>? AND title LIKE \'Demo: %\'', [alertMark.id]);
    await pool.query('DELETE FROM simulation_state');
    await pool.query('DELETE FROM electricity_usage');
    for (const row of originalState) await pool.query('INSERT INTO simulation_state SET ?', [row]);
    for (const row of originalUsage) await pool.query('INSERT INTO electricity_usage SET ?', [row]);
    for (const id of madeRooms) await pool.query('DELETE FROM rooms WHERE id=?', [id]);
    for (const t of thresholds) await pool.query('UPDATE thresholds SET warn_value=?,limit_value=?,updated_by=? WHERE metric=?', [t.warn_value,t.limit_value,t.updated_by,t.metric]);
    if (settings[0]) await pool.query("UPDATE settings SET setting_value=? WHERE setting_key='fan_trigger'", [settings[0].setting_value]);
    for (const m of modes) await pool.query('UPDATE rooms SET vent_mode=? WHERE id=?', [m.vent_mode,m.id]);
    await pool.query('DELETE FROM sms_recipients WHERE phone IN (?)', [phones]);
    await pool.query('DELETE FROM users WHERE email IN (?)', [emails]);
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
