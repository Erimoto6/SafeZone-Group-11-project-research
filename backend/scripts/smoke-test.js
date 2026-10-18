// Run with:  npm run test
// Starts the API on a spare port and tries everything against your real MySQL database
// (register, login, forgot password, rooms, settings, SMS list, alerts, permissions).
// It cleans up after itself and puts your settings back the way they were.
require('dotenv').config({ quiet: true });
if (process.env.SAFEZONE_TEST_DB !== '1') throw new Error('Set SAFEZONE_TEST_DB=1 with a disposable database before running tests.');
// Tests must never send email to a real recipient.
process.env.SMTP_HOST = '';

const tag = Date.now().toString(36);
process.env.RATE_LIMIT = 'off';
process.env.ADMIN_ACCESS_CODE = 'SMOKE-' + tag;
process.env.DEVICE_API_KEY = 'smoke-key-' + tag;
process.env.NODE_ENV = 'test';

const app = require('../src/app');
const { pool } = require('../src/db');
const mail = require('../src/mail');
const bcrypt = require('bcryptjs');

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : fail++; console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); };
const section = t => console.log('\n' + t);

const server = app.listen(0, '127.0.0.1');
const base = () => `http://127.0.0.1:${server.address().port}`;
async function call(method, path, body, token, extraHeaders) {
  const headers = { 'Content-Type': 'application/json', ...(extraHeaders || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base() + path, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  let json = null; try { json = await r.json(); } catch (e) { /* no body */ }
  return { status: r.status, body: json };
}

const n9 = String(Date.now()).slice(-8);                  // makes phone numbers unique per run
const P = { s1: '091' + n9, s2: '092' + n9, s3: '093' + n9, s4: '094' + n9, f1: '095' + n9, a1: '096' + n9, a2: '097' + n9, sms: '098' + n9, sms2: '099' + n9 };
const E = k => `smoke.${tag}.${k}`;
const MAIL = { student: k => `${E(k)}@iskolarngbayan.pup.edu.ph`, faculty: k => `${E(k)}@pup.edu.ph` };

(async () => {
  // remember what we change so we can put it back
    const [thrRows] = await pool.query('SELECT metric, warn_value, limit_value FROM thresholds');
  const [fanRows] = await pool.query("SELECT setting_value FROM settings WHERE setting_key = 'fan_trigger'");
  const [roomModes] = await pool.query('SELECT id, vent_mode FROM rooms');
  const madeRooms = [];

  try {
    section('Health');
    let r = await call('GET', '/api/health');
    ok(r.status === 200 && r.body.database === 'connected', 'API is up and MySQL is connected');
    ok(r.body.mail === 'test-mode' || r.body.mail === 'smtp', 'health says whether email is set up (' + r.body.mail + ')');
    r = await call('GET', '/api/nope'); ok(r.status === 404 && r.body.error, 'unknown address gives a clean 404');
    r = await call('POST', '/api/auth/login', '{bad json'); ok(r.status === 400, 'broken JSON gives a clean 400');

    section('Student / faculty registration');
    r = await call('POST', '/api/auth/register', { email: 'x@gmail.com', phone: P.s1, password: 'abc123' }); ok(r.status === 400 && /PUP web mail/.test(r.body.error), 'rejects a non-PUP email');
    for (const bad of [`a${tag}@mail.pup.edu.ph`, `a${tag}@evilpup.edu.ph`, `a${tag}@pup.edu.ph.evil.com`, `@pup.edu.ph`]) {
      r = await call('POST', '/api/auth/register', { email: bad, phone: P.s1, password: 'abc123' });
      if (r.status !== 400) ok(false, 'should reject ' + bad);
    }
    ok(true, 'rejects look-alike domains (subdomain, evilpup.edu.ph, trailing domain, no name)');
    r = await call('POST', '/api/auth/register', { email: MAIL.student('s1'), phone: '12345', password: 'abc123' }); ok(r.status === 400 && /mobile/.test(r.body.error), 'rejects a bad mobile number');
    r = await call('POST', '/api/auth/register', { email: MAIL.student('s1'), phone: P.s1, password: 'abc' }); ok(r.status === 400, 'rejects a weak password');
    r = await call('POST', '/api/auth/register', { email: MAIL.student('s1').toUpperCase(), phone: P.s1, password: 'abc123' });
    ok(r.status === 201 && r.body.user.kind === 'student' && r.body.user.email === MAIL.student('s1') && r.body.user.role === 'viewer', 'student registers (upper case email is saved lower case)');
    ok(!JSON.stringify(r.body).includes('abc123') && !('password_hash' in r.body.user), 'the reply never contains the password or its hash');
    r = await call('POST', '/api/auth/register', { email: MAIL.faculty('f1'), phone: P.f1, password: 'abc123' }); ok(r.status === 201 && r.body.user.kind === 'faculty', 'faculty registers (@pup.edu.ph)');
    r = await call('POST', '/api/auth/register', { email: MAIL.student('s1'), phone: P.s2, password: 'abc123' }); ok(r.status === 409 && /web mail/.test(r.body.error), 'same web mail cannot register twice');
    r = await call('POST', '/api/auth/register', { email: MAIL.student('s2'), phone: P.s1, password: 'abc123' }); ok(r.status === 409 && /mobile number/.test(r.body.error), 'same mobile number cannot register twice');
    const [[row]] = await pool.query('SELECT password_hash FROM users WHERE email = ?', [MAIL.student('s1')]);
    ok(/^\$2[aby]\$/.test(row.password_hash) && !row.password_hash.includes('abc123'), 'the database holds a bcrypt hash, not the password');
    const [sms] = await pool.query('SELECT role, name, sms_enabled FROM sms_recipients WHERE phone = ?', [P.s1]);
    ok(sms.length === 1 && sms[0].role === 'Student' && sms[0].name === 'Unnamed user' && sms[0].sms_enabled === 1, 'a new student is added to the SMS list as "Unnamed user", role Student');
    const [sms2] = await pool.query('SELECT role FROM sms_recipients WHERE phone = ?', [P.f1]); ok(sms2[0] && sms2[0].role === 'Faculty', 'a faculty account gets role Faculty in the SMS list');

    section('Login');
    r = await call('POST', '/api/auth/login', { identifier: P.s1, password: 'abc123', as: 'viewer' });
    ok(r.status === 200 && r.body.token && r.body.user.phone === P.s1, 'log in with the mobile number');
    const sTok = r.body.token;
    r = await call('POST', '/api/auth/login', { identifier: MAIL.student('s1'), password: 'abc123' }); ok(r.status === 200, 'log in with the web mail');
    r = await call('POST', '/api/auth/login', { identifier: P.s1, password: 'wrong999' }); ok(r.status === 401, 'wrong password is refused');
    r = await call('POST', '/api/auth/login', { identifier: '0900000000000', password: 'abc123' }); ok(r.status === 401 && r.body.error === 'Wrong login details. Check them and try again.', 'unknown account gives the same message as a wrong password');
    r = await call('POST', '/api/auth/login', { identifier: P.s1, password: 'abc123', as: 'admin' }); ok(r.status === 401, 'a student cannot log in on the admin side');
    r = await call('POST', '/api/auth/login', { identifier: "' OR '1'='1", password: "' OR '1'='1" }); ok(r.status === 401, 'an SQL-injection attempt is just a failed login');
    r = await call('GET', '/api/auth/me', undefined, sTok); ok(r.status === 200 && r.body.user.email === MAIL.student('s1'), 'the token opens /me');
    r = await call('GET', '/api/auth/me'); ok(r.status === 401, 'no token = 401');
    r = await call('GET', '/api/auth/me', undefined, 'not.a.token'); ok(r.status === 401, 'a fake token = 401');

    section('Admin accounts and permissions');
    const adminBody = (k, ph, u) => ({ fullName: 'Smoke Admin ' + k, username: u, email: MAIL.faculty(k), phone: ph, password: 'admin123', accessCode: process.env.ADMIN_ACCESS_CODE });
    r = await call('POST', '/api/auth/register-admin', { ...adminBody('a1', P.a1, 'sm' + tag), accessCode: 'WRONG' }); ok(r.status === 403, 'wrong admin access code is refused');
    r = await call('POST', '/api/auth/register-admin', adminBody('a1', P.a1, 'sm' + tag)); ok(r.status === 201 && r.body.user.role === 'admin', 'admin registers with the access code');
    const adminUser = 'sm' + tag;
    r = await call('POST', '/api/auth/login', { identifier: adminUser, password: 'admin123', as: 'admin' }); ok(r.status === 200 && r.body.user.role === 'admin', 'admin logs in with the username');
    const aTok = r.body.token;
    r = await call('GET', '/api/admin/users', undefined, sTok); ok(r.status === 403, 'a student cannot open the admin user list');
    r = await call('GET', '/api/admin/users', undefined, aTok); ok(r.status === 200 && r.body.admins.some(a => a.username === adminUser) && r.body.viewers.some(x => x.phone === P.s1), 'admin sees admins and registered students');
    r = await call('POST', '/api/admin/users', { fullName: 'Second Admin', username: 'sm2' + tag, email: 'x@gmail.com', phone: P.a2, password: 'admin123' }, aTok); ok(r.status === 400, 'Add another admin needs a PUP web mail');
    r = await call('POST', '/api/admin/users', { fullName: 'Second Admin', username: 'sm2' + tag, email: MAIL.faculty('a2'), phone: P.a2, password: 'admin123' }, sTok); ok(r.status === 403, 'a student cannot add an admin');
    r = await call('POST', '/api/admin/users', { fullName: 'Second Admin', username: 'sm2' + tag, email: MAIL.faculty('a2'), phone: P.a2, password: 'admin123' }, aTok); ok(r.status === 201 && r.body.user.role === 'admin', 'an admin adds another admin');
    r = await call('POST', '/api/auth/login', { identifier: 'sm2' + tag, password: 'admin123', as: 'admin' }); ok(r.status === 200, 'the new admin can log in');
    r = await call('POST', '/api/admin/users', { fullName: 'Dup', username: 'sm2' + tag, email: MAIL.faculty('a3'), phone: '09' + String(Date.now()).slice(-9), password: 'admin123' }, aTok); ok(r.status === 409 && /username/.test(r.body.error), 'a taken username is refused');

    section('Rooms');
    r = await call('GET', '/api/rooms'); ok(r.status === 401, 'rooms need a login');
    r = await call('GET', '/api/rooms', undefined, sTok);
    const names = (r.body.rooms || []).map(x => x.name);
    ok(r.status === 200 && ['Room 101', 'Room 105', 'Room 110'].every(n => names.includes(n)), 'students can list rooms (Room 101 to 110 are there)');
    r = await call('POST', '/api/rooms', { floor: 4, roomNo: 401 }, sTok); ok(r.status === 403, 'a student cannot add a room');
    r = await call('POST', '/api/rooms', { floor: 4, roomNo: 301 }, aTok); ok(r.status === 400 && /401/.test(r.body.error), 'a 3xx number is refused on the 4th floor');
    r = await call('POST', '/api/rooms', { floor: 5, roomNo: 501 }, aTok); ok(r.status === 400, 'floor 5 is refused (only 4 floors)');
    r = await call('POST', '/api/rooms', { floor: 1, roomNo: 101 }, aTok); ok(r.status === 409, 'Room 101 already exists');
    const roomNo = 400 + 1 + (Date.now() % 90) + 5;      // a 4xx number unlikely to exist
    r = await call('POST', '/api/rooms', { floor: 4, roomNo, lights: 10, wattsPerLight: 20, fanWatts: 50 }, aTok);
    ok(r.status === 201 && r.body.room.name === 'Room ' + roomNo && r.body.room.lights === 10 && r.body.room.wattsPerLight === 20, `admin adds Room ${roomNo} on the 4th floor`);
    const roomId = r.body.room.id; madeRooms.push(roomId);
    const [dev] = await pool.query('SELECT COUNT(*) AS n FROM device_status WHERE room_id = ?', [roomId]); ok(dev[0].n === 8, 'the new room gets its 8 device rows');
    r = await call('PATCH', '/api/rooms/' + roomId, { ventMode: 'manual' }, aTok); ok(r.status === 200 && r.body.room.ventMode === 'manual', 'ventilation mode of one room can change');
    r = await call('PATCH', '/api/rooms/' + roomId, { ventMode: 'sideways' }, aTok); ok(r.status === 400, 'a bad mode is refused');
    r = await call('DELETE', '/api/rooms/' + roomId, undefined, sTok); ok(r.status === 403, 'a student cannot remove a room');
    r = await call('DELETE', '/api/rooms/' + roomId, undefined, aTok); ok(r.status === 200, 'admin removes the room'); madeRooms.length = 0;
    r = await call('DELETE', '/api/rooms/' + roomId, undefined, aTok); ok(r.status === 404, 'removing it twice gives 404');

    section('Settings (limits, fan trigger, mode)');
    r = await call('GET', '/api/settings', undefined, sTok); ok(r.status === 200 && r.body.thresholds.co2 && r.body.fanTrigger, 'anyone logged in can read the limits');
    ok(Number.isInteger(r.body.smsEnabledCount), 'settings tell everyone how many people get SMS (' + r.body.smsEnabledCount + ')');
    r = await call('PUT', '/api/settings', { fanTrigger: 'warning' }, sTok); ok(r.status === 403, 'a student cannot change settings');
    r = await call('PUT', '/api/settings', { thresholds: { temp: { warn: 33, limit: 32 }, hum: { warn: 65, limit: 75 }, co2: { warn: 1000, limit: 1200 } } }, aTok); ok(r.status === 400, 'a warning above the limit is refused');
    r = await call('PUT', '/api/settings', { thresholds: { temp: { warn: 29, limit: 31 }, hum: { warn: 60, limit: 70 }, co2: { warn: 900, limit: 1100 } }, fanTrigger: 'warning', ventMode: 'manual' }, aTok);
    ok(r.status === 200 && r.body.thresholds.temp.warn === 29 && r.body.thresholds.co2.limit === 1100 && r.body.fanTrigger === 'warning' && r.body.ventMode === 'manual', 'admin saves limits, fan trigger and mode');
    r = await call('GET', '/api/settings', undefined, sTok); ok(r.body.thresholds.hum.limit === 70, 'the change is saved in MySQL');
    r = await call('PUT', '/api/settings', { fanTrigger: 'purple' }, aTok); ok(r.status === 400, 'a bad fan trigger is refused');

    section('SMS Alerts (name, role, number)');
    r = await call('GET', '/api/sms-recipients', undefined, sTok); ok(r.status === 403, 'students cannot see the SMS list');
    r = await call('POST', '/api/sms-recipients', { name: 'Mr. Cruz', role: 'Maintenance', phone: '123' }, aTok); ok(r.status === 400, 'bad number refused');
    r = await call('POST', '/api/sms-recipients', { name: '', role: 'Maintenance', phone: P.sms }, aTok); ok(r.status === 400, 'a name is required');
    r = await call('POST', '/api/sms-recipients', { name: 'Mr. Cruz', role: 'Maintenance', phone: P.sms }, aTok); ok(r.status === 201 && r.body.recipient.smsEnabled === true, 'admin adds a recipient');
    const rid = r.body.recipient.id;
    r = await call('POST', '/api/sms-recipients', { name: 'Dup', role: 'Other', phone: P.sms }, aTok); ok(r.status === 409, 'the same number cannot be added twice');
    r = await call('PATCH', '/api/sms-recipients/' + rid, { smsEnabled: false, role: 'Faculty', name: 'Mr. Cruz Jr.' }, aTok); ok(r.status === 200 && r.body.recipient.smsEnabled === false && r.body.recipient.role === 'Faculty' && r.body.recipient.name === 'Mr. Cruz Jr.', 'admin edits and switches a recipient off');
    r = await call('GET', '/api/sms-recipients', undefined, aTok); ok(r.body.recipients.some(x => x.id === rid && x.name === 'Mr. Cruz Jr.') && r.body.recipients.some(x => x.phone === P.s1), 'the list holds the new person and the registered student');
    r = await call('DELETE', '/api/sms-recipients/' + rid, undefined, aTok); ok(r.status === 200, 'admin removes a recipient');

    section('Alerts');
    r = await call('POST', '/api/alerts', { type: 'warning', title: 'smoke', body: 'test' }); ok(r.status === 403, 'adding an alert needs the device key');
    const [[room1]] = await pool.query('SELECT id FROM rooms ORDER BY room_no LIMIT 1');
    r = await call('POST', '/api/alerts', { roomId: room1.id, type: 'exceeded', title: 'smoke High CO2', body: 'CO2 reached 1,350 ppm.', metric: 'co2', value: 1350, smsSent: 3 }, undefined, { 'X-API-Key': process.env.DEVICE_API_KEY });
    ok(r.status === 201, 'the alert service can add an alert');
    r = await call('POST', '/api/alerts', { type: 'weird', title: 'smoke', body: 'x' }, undefined, { 'X-API-Key': process.env.DEVICE_API_KEY }); ok(r.status === 400, 'a bad alert type is refused');
    r = await call('GET', '/api/alerts?limit=5', undefined, sTok);
    const al = (r.body.alerts || []).find(a => a.title === 'smoke High CO2');
    ok(r.status === 200 && al && al.type === 'exceeded' && al.cats.includes('message') && al.sms === true && al.room && al.value === 1350 && typeof al.ts === 'number', 'students can read the alerts list');
    r = await call('GET', '/api/alerts?roomId=' + room1.id, undefined, sTok); ok(r.status === 200 && r.body.alerts.every(a => a.roomId === room1.id), 'alerts can be filtered by room');

    section('Forgot password');
    r = await call('POST', '/api/auth/forgot', { email: 'someone@gmail.com' }); ok(r.status === 400, 'a non-PUP address is refused');
    r = await call('POST', '/api/auth/forgot', { email: MAIL.student('nobody') });
    ok(r.status === 200 && /If that web mail is registered/.test(r.body.message) && !mail.lastCodes.has(MAIL.student('nobody')), 'unknown web mail: same reply, no code made');
    const unknownReply = r.body.message;
    r = await call('POST', '/api/auth/forgot', { email: MAIL.student('s1') });
    ok(r.status === 200 && r.body.message === unknownReply, 'known web mail: exactly the same reply (nobody can tell who is registered)');
    const codeA = mail.lastCodes.get(MAIL.student('s1'));
    ok(/^\d{6}$/.test(codeA || ''), 'a 6-digit code was created: ' + codeA);
    const [[cr]] = await pool.query('SELECT code_hash FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE u.email = ? ORDER BY pr.id DESC LIMIT 1', [MAIL.student('s1')]);
    ok(cr && cr.code_hash.length === 64 && !cr.code_hash.includes(codeA), 'only a hash of the code is stored');
    r = await call('POST', '/api/auth/forgot', { email: MAIL.student('s1') }); ok(r.status === 429 && /wait/.test(r.body.error), 'asking again right away is refused (30 second wait)');
    r = await call('POST', '/api/auth/verify-code', { email: MAIL.student('s1'), code: 'abc' }); ok(r.status === 400, 'a non-numeric code is refused');
    const wrongA = codeA === '000000' ? '111111' : '000000';
    r = await call('POST', '/api/auth/verify-code', { email: MAIL.student('s1'), code: wrongA }); ok(r.status === 400, 'a wrong code is refused');
    r = await call('POST', '/api/auth/reset', { resetToken: 'nope', newPassword: 'newpass1' }); ok(r.status === 400, 'reset without a verified code is refused');
    r = await call('POST', '/api/auth/verify-code', { email: MAIL.student('s1'), code: codeA }); ok(r.status === 200 && r.body.resetToken, 'the right code gives a reset token');
    const resetTok = r.body.resetToken;
    r = await call('GET', '/api/auth/me', undefined, resetTok); ok(r.status === 401, 'a reset token cannot be used as a login');
    r = await call('POST', '/api/auth/reset', { resetToken: resetTok, newPassword: 'abc' }); ok(r.status === 400, 'a weak new password is refused');
    r = await call('POST', '/api/auth/reset', { resetToken: resetTok, newPassword: 'newpass1' }); ok(r.status === 200, 'the new password is saved');
    r = await call('POST', '/api/auth/reset', { resetToken: resetTok, newPassword: 'another2' }); ok(r.status === 400, 'the same reset cannot be used twice');
    r = await call('POST', '/api/auth/login', { identifier: P.s1, password: 'abc123' }); ok(r.status === 401, 'the old password no longer works');
    r = await call('POST', '/api/auth/login', { identifier: P.s1, password: 'newpass1' }); ok(r.status === 200, 'the new password works');
    r = await call('GET', '/api/auth/me', undefined, sTok); ok(r.status === 401, 'the old login is signed out after a reset');
    const sTok2 = r.status === 401 ? (await call('POST', '/api/auth/login', { identifier: P.s1, password: 'newpass1' })).body.token : null;

    // five wrong guesses lock the code, even the right one is then refused
    r = await call('POST', '/api/auth/register', { email: MAIL.student('s3'), phone: P.s3, password: 'abc123' });
    await call('POST', '/api/auth/forgot', { email: MAIL.student('s3') });
    const codeB = mail.lastCodes.get(MAIL.student('s3')); const wrongB = codeB === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await call('POST', '/api/auth/verify-code', { email: MAIL.student('s3'), code: wrongB });
    r = await call('POST', '/api/auth/verify-code', { email: MAIL.student('s3'), code: codeB }); ok(r.status === 400, 'after 5 wrong tries even the right code is refused');

    // an expired code is refused
    r = await call('POST', '/api/auth/register', { email: MAIL.student('s4'), phone: P.s4, password: 'abc123' });
    await call('POST', '/api/auth/forgot', { email: MAIL.student('s4') });
    const codeC = mail.lastCodes.get(MAIL.student('s4'));
    await pool.query('UPDATE password_resets pr JOIN users u ON u.id = pr.user_id SET pr.expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE u.email = ?', [MAIL.student('s4')]);
    r = await call('POST', '/api/auth/verify-code', { email: MAIL.student('s4'), code: codeC }); ok(r.status === 400, 'an expired code is refused');

    section('Change password and web mail');
    r = await call('POST', '/api/auth/change-password', { currentPassword: 'wrong111', newPassword: 'fresh123' }, sTok2); ok(r.status === 401, 'wrong current password is refused');
    r = await call('POST', '/api/auth/change-password', { currentPassword: 'newpass1', newPassword: 'fresh123' }, sTok2);
    ok(r.status === 200 && r.body.token, 'password changes and a new login token comes back');
    const sTok3 = r.body.token;
    r = await call('GET', '/api/auth/me', undefined, sTok2); ok(r.status === 401, 'the previous login stops working');
    r = await call('GET', '/api/auth/me', undefined, sTok3); ok(r.status === 200, 'the new token works');
    r = await call('PUT', '/api/auth/me/email', { email: 'me@gmail.com' }, aTok); ok(r.status === 400, 'a non-PUP web mail cannot be saved');
    r = await call('PUT', '/api/auth/me/email', { email: MAIL.student('s1') }, aTok); ok(r.status === 409, "someone else's web mail cannot be taken");
    r = await call('PUT', '/api/auth/me/email', { email: MAIL.faculty('a1new') }, aTok); ok(r.status === 200 && r.body.user.email === MAIL.faculty('a1new'), 'an admin can change their own web mail');

    section('Browser access (CORS)');
    r = await call('GET', '/api/health', undefined, undefined, { Origin: 'https://evil.example.com' }); ok(r.status === 403, 'an unknown website is refused');
    r = await call('GET', '/api/health', undefined, undefined, { Origin: 'https://localhost' }); ok(r.status === 200, 'the Android app (https://localhost) is allowed');
  } catch (e) {
    fail++; console.log('  FAIL  the test crashed: ' + (e.stack || e.message));
  } finally {
    // ---- clean up and put settings back ----
    try {
      for (const t of thrRows) await pool.query('UPDATE thresholds SET warn_value = ?, limit_value = ?, updated_by = NULL WHERE metric = ?', [t.warn_value, t.limit_value, t.metric]);
      if (fanRows[0]) await pool.query("UPDATE settings SET setting_value = ? WHERE setting_key = 'fan_trigger'", [fanRows[0].setting_value]);
      for (const m of roomModes) await pool.query('UPDATE rooms SET vent_mode = ? WHERE id = ?', [m.vent_mode, m.id]);
      for (const id of madeRooms) await pool.query('DELETE FROM rooms WHERE id = ?', [id]);
      await pool.query("DELETE FROM alerts WHERE title LIKE 'smoke%'");
      await pool.query('DELETE FROM sms_recipients WHERE phone IN (?)', [Object.values(P)]);
      await pool.query("DELETE FROM notification_log WHERE to_address LIKE 'smoke.%'");
      await pool.query("DELETE FROM users WHERE email LIKE 'smoke.%'");
    } catch (e) { console.log('  (clean-up problem: ' + e.message + ')'); }
    console.log(`\n${fail ? 'SOME TESTS FAILED' : 'ALL TESTS PASSED'}  (${pass} passed, ${fail} failed)\n`);
    server.close(); await pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
