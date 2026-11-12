(() => {
'use strict';

/* =====================================================================
   CONFIG: edit these first
   ===================================================================== */
// Supplied artwork: theme-aware by default; student login uses fixed pink.
const FEATURES = { fanEnergy: false }; // Retained for restoring the fan-energy view later.
const LOGOS = { red: 'images/light%20mode.png', pink: 'images/dark%20mode.png' };

// Button names on the start screen. Change the wording here.
const LABELS = { viewer: 'Student / Faculty', control: 'Admin' };

// PUP web mail (Outlook). Students use @iskolarngbayan.pup.edu.ph, faculty use @pup.edu.ph.
// It is used to verify a person when they forget their password.
const WEBMAIL = { student: 'iskolarngbayan.pup.edu.ph', faculty: 'pup.edu.ph' };
const RESET_MINUTES = 10;        // how long a reset code works
const RESET_TRIES = 5;           // wrong guesses allowed per code
const RESEND_SECONDS = 30;       // wait before asking for another code
// Shown on the About screen.
const CONTACT = { email: 'safezone@yourschool.edu' };

// Starting limits. Admins can change them in Settings.
// These are placeholders: use the values from your paper / sensor calibration.
const DEFAULT_LIMITS = {
  temp: { warn: 30,   limit: 32 },    // °C
  hum:  { warn: 65,   limit: 75 },    // %
  co2:  { warn: 1000, limit: 1200 }   // ppm
};

// Rooms shown the first time the app opens. Admins add more with the + button.
const FLOORS = 4;                                   // how many floors the building has
// Classroom roster excludes the clinic, offices and campus library.
// Rooms are numbered by floor: 1st = 101, 102...  2nd = 201, 202...  3rd = 301...  4th = 401...
const EXCLUDED_ROOMS = [108, 205, 210, 307, 309];
const DEFAULT_ROOMS = Array.from({ length: 4 }, (_, i) => i + 1).flatMap(floor =>
  Array.from({ length: 12 }, (_, i) => floor * 100 + i + 1).filter(n => !EXCLUDED_ROOMS.includes(n)).map(n => ({ name: 'Room ' + n, floor })));
const ROOMS_V = 2;                                  // bump when the default rooms change (runs a one-time update)

// A new room starts with these numbers. Admins can change them when adding a room.
// (Used for the power display. With a real power meter the total comes from the meter.)
const ROOM_DEFAULTS = { lights: 0, lightWatts: 18, fanWatts: 40 };

const COURSES = {
  BSA:'Bachelor of Science in Accountancy', BSIT:'Bachelor of Science in Information Technology',
  'BSBA-MM':'Bachelor of Science in Business Administration major in Marketing Management',
  'BSBA-HRM':'Bachelor of Science in Business Administration major in Human Resource Management',
  BSP:'Bachelor of Science in Psychology', BSECE:'Bachelor of Science in Electronics Engineering',
  BSIE:'Bachelor of Science in Industrial Engineering'
};
const courseName = code => COURSES[code] || 'Course not set';
function profileFields(prefix,profile={}) {
  return `<label class="f" for="${prefix}-course">Course</label><select id="${prefix}-course" aria-label="Course"><option value="">Choose your course</option>${Object.entries(COURSES).map(([code,name])=>`<option value="${code}" ${profile.courseCode===code?'selected':''}>${name} (${code})</option>`).join('')}</select>
    <label class="f" for="${prefix}-section">Section</label><input type="text" id="${prefix}-section" aria-label="Section" maxlength="40" placeholder="Enter your section, e.g. 1-1" value="${esc(profile.section || '')}">`;
}
function readProfile(prefix) {
  const courseCode=$('#'+prefix+'-course').value,section=$('#'+prefix+'-section').value.trim();
  if(!Object.hasOwn(COURSES,courseCode))throw new Error('Choose your course.');
  if(!section||section.length>40)throw new Error('Enter your section (up to 40 characters).');
  return {courseCode,section};
}

// Choices in the SMS Alerts "role" list.
const ROLES = ['Admin', 'Faculty', 'Student', 'Student / Faculty', 'Maintenance', 'Other'];

/* =====================================================================
   DATA LAYER
   Readings come from the shared backend simulator. Real hardware integration
   can later replace that source without running a simulator on each phone.
   ===================================================================== */
const BASE = { temp: 27.4, hum: 58, co2: 827 };
const KEYS = ['temp', 'hum', 'co2'];

const METRICS = {
  temp: { label: 'Temperature', unit: '°C',  icon: 'thermo', axis: [20, 36],   step: 4 },
  hum:  { label: 'Humidity',    unit: '%',   icon: 'drop',   axis: [20, 100],  step: 20 },
  co2:  { label: 'CO₂',         unit: 'ppm', icon: 'cloud',  axis: [400, 1600], step: 400 }
};
const LV = { normal: 'Normal', warning: 'Warning', exceeded: 'Danger' };   // green, yellow, red
const RANK = { normal: 0, warning: 1, exceeded: 2 };

/* =====================================================================
   STATE
   ===================================================================== */
const S = {
  role: null,                 // null | 'student' (Student / Faculty) | 'admin'
  screen: 'splash',           // splash | vWelcome | vReg1 | vReg2 | vDone | vLogin | login | home | alerts | monitor | status | settings | about
  mon: { view: 'live', metric: 'temp', range: '6h' },
  alertFilter: 'all', alertView: 'active', archiveAvailable: false, overviewFloor: 'all', studentCourse: null, studentSection: null,
  temperatureAnalytics: {range:'7d',data:null,loading:false,error:'',fetchedAt:0},
  rooms: [],                  // every room has its own readings, levels and fan. Built in init().
  roomId: null,               // the room being viewed
  fanTrigger: 'exceeded',     // when automatic ventilation turns ON: 'warning' (yellow) | 'exceeded' (red)
  draftTrigger: 'exceeded',
  limits: JSON.parse(JSON.stringify(DEFAULT_LIMITS)),
  alerts: [],
  simScope: 'current', simSelected: [], syncError: '', editingRoomId: null, configRoomId: null,
  pendingDel: '',             // two-tap delete: remembers which Remove? button was tapped once
  addFloor: 2,                // floor chosen in the Add Room form
  reset: null,                // forgot-password progress: { side, email, code, exp, tries, ... }
  resetSide: 'viewer',
  theme: null,                // null = follow the phone | 'light' | 'dark'
  unread: 0,
  draftAuto: true,
  authError: '',
  notice: '',
  reg: { phone: '' },
  accounts: [],
  me: null,
  session: null,
  lastUpdate: Date.now(),
  users: [
    { name: 'Administrator',     role: 'Admin',   phone: '0917 000 0001', sms: true },
    { name: 'Class Adviser',     role: 'Faculty', phone: '0917 000 0002', sms: true }
  ]
};

// S.reading, S.buf, S.levels, S.prevWorst, S.vent and S.scenario always mean
// "the room being viewed or processed", so most of the code does not care which room it is.
const cur = () => S.rooms.find(r => r.id === S.roomId) || S.rooms[0];
['reading', 'buf', 'levels', 'prevWorst', 'vent', 'scenario'].forEach(k =>
  Object.defineProperty(S, k, { get() { return cur()[k]; }, set(v) { cur()[k] = v; } }));
function eachRoom(fn) { const keep = S.roomId; S.rooms.forEach(r => { S.roomId = r.id; fn(r); }); S.roomId = keep; }

/* ---------- storage (safe) ---------- */
const store = {
  load() { try { return JSON.parse(localStorage.getItem('safezone.preferences') || 'null'); } catch { return null; } },
  save() { try { localStorage.setItem('safezone.preferences', JSON.stringify({ theme: S.theme, roomId: S.roomId })); } catch { /* preferences are optional */ } }
};
let token = sessionStorage.getItem('safezone.token') || '';
const API_BASE = (window.SAFEZONE_API_BASE || '/api').replace(/\/$/, '');
async function api(path, method = 'GET', body) {
  const requestToken = token;
  let response;
  try {
    response = await fetch(API_BASE + path, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(requestToken ? { Authorization: 'Bearer ' + requestToken } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000)
    });
  } catch { throw new Error(navigator.onLine===false?'No network connection. Reconnect to Wi-Fi or mobile data and try again.':'Cannot reach the SafeZone server. Check the backend address and network connection, then try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token === requestToken && token && path !== '/auth/change-password') {
      signOut(); render();
    }
    throw new Error(data.error || 'The request failed. Please try again.');
  }
  return data;
}
function signOut() {
  captureEnabled=false; formDrafts.clear(); settingsDraft=null; settingsDirty=false;
  token = ''; sessionStorage.removeItem('safezone.token');
  S.role = null; S.me = null; S.session = null; S.accounts = []; S.users = []; S.alerts = []; S.unread = 0;
  alertWatermarks.clear(); S.syncError = ''; S.simSelected = []; S.simScope = 'current'; S.configRoomId = null;
  S.alertView='active';S.archiveAvailable=false;S.studentCourse=null;S.studentSection=null;
  S.temperatureAnalytics={range:'7d',data:null,loading:false,error:'',fetchedAt:0};
  S.screen = 'splash'; S.reg = { phone: '' }; S.reset = null; S.studentProfile = null; closeSheet();
}
const mapUser = u => ({ ...u, name: u.fullName || u.username || 'Unnamed user' });
const alertUrl=(roomId=S.roomId)=>'/alerts?roomId='+encodeURIComponent(roomId)+'&limit=200&archived='+(S.alertView==='archived'?'1':'0');
async function refreshData() {
  const [rooms, settings, shared] = await Promise.all([api('/rooms'), api('/settings'), api('/simulation')]);
  const previous = new Map(S.rooms.map(r => [r.id, r]));
  S.rooms = rooms.rooms.slice().sort((a,b) => a.floor-b.floor || a.name.localeCompare(b.name, undefined, {numeric:true})).map(r => {
    const room = previous.get(String(r.id)) || makeRoom({ ...r, id: String(r.id), lightWatts: r.wattsPerLight, mode: r.ventMode });
    Object.assign(room, { name: r.name, floor: r.floor, lights: r.lights, lightWatts: r.wattsPerLight, fanWatts: r.fanWatts });
    room.vent.mode = r.ventMode; return room;
  });
  if (!S.rooms.length) throw new Error('No rooms are configured. Ask an administrator to add one.');
  if (!S.rooms.some(r => r.id === S.roomId)) S.roomId = S.rooms[0].id;
  S.limits = settings.thresholds; S.fanTrigger = settings.fanTrigger; S.draftTrigger = S.fanTrigger;
  S.draftAuto = settings.ventMode === 'auto';
  const alerts=await api(alertUrl());
  S.archiveAvailable=alerts.archiveAvailable===true;
  applyShared(shared, alerts.alerts);
  if (S.role === 'admin') {
    const [people, sms] = await Promise.all([api('/admin/users'), api('/sms-recipients')]);
    S.accounts = [...people.admins, ...people.viewers].map(mapUser);
    S.users = sms.recipients.map(u => ({ ...u, sms: u.smsEnabled, phone: showPhone(u.phone) }));
  } else { S.accounts = []; S.users = []; }
}
async function signedIn(data) {
  token = data.token; sessionStorage.setItem('safezone.token', token);
  S.me = mapUser(data.user); S.role = data.user.role === 'admin' ? 'admin' : 'student';
  S.roomId = null; // Every login starts at the first configured room, normally Room 101.
  try { await refreshData(); } catch (e) { signOut(); render(); throw e; }
  S.authError = ''; S.notice = ''; S.reg = { phone: '' }; S.screen = 'home'; render();
}

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const t12 = d => { let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(m)} ${ap}`; };
const tShort = d => { let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return m ? `${h}:${pad(m)} ${ap}` : `${h} ${ap}`; };
const tSec = d => { let h = d.getHours(); h = h % 12 || 12; return `${h}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const when = ts => {
  const d = new Date(ts); const diff = Math.round((dayStart(new Date()) - dayStart(d)) / 864e5);
  const w = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${w}, ${t12(d)}`;
};
const fmt = (k, v) => k === 'temp' ? v.toFixed(1) : Math.round(v).toLocaleString('en-US');
const withUnit = (k, v) => `${fmt(k, v)} ${METRICS[k].unit}`;
const levelOf = (k, v) => { const t = S.limits[k]; return v >= t.limit ? 'exceeded' : v >= t.warn ? 'warning' : 'normal'; };
const worst = () => Math.max(...KEYS.map(k => RANK[S.levels[k]]));
const worstName = () => ['normal', 'warning', 'exceeded'][worst()];
const hashStr = x => { let h = 7; for (const c of String(x)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const energyText = value => Number(value || 0).toFixed(4) + ' kWh';
const ord = n => { const v = n % 100; return n + ((v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'); };
const floorName = f => ord(f) + ' Floor';
const floorList = () => Array.from({ length: Math.max(FLOORS, ...S.rooms.map(r => r.floor || 1)) }, (_, i) => i + 1);
// "Room 301" -> 3rd floor. Used for rooms saved before floors existed.
const guessFloor = name => { const m = String(name).match(/(\d)\d\d/); const f = m ? +m[1] : 1; return f >= 1 && f <= FLOORS ? f : 1; };
const roomNo = r => { const m = String(r.name).match(/\d+/); return m ? parseInt(m[0], 10) : 0; };
const roomsOn = f => S.rooms.filter(r => r.floor === f).sort((a, b) => roomNo(a) - roomNo(b) || a.name.localeCompare(b.name));
// Next free number on a floor: 1st -> 101, 102...  2nd -> 201, 202...
const nextRoomNumber = f => { for (let n = f * 100 + 1; n <= f * 100 + 12; n++) if (!EXCLUDED_ROOMS.includes(n) && !S.rooms.some(r => r.name.toLowerCase() === 'room ' + n)) return n; return null; };
const floorHint = f => {
  const excluded = EXCLUDED_ROOMS.filter(n => Math.floor(n / 100) === f);
  return `${ord(f)} floor classrooms: ${f}01–${f}12.${excluded.length ? ' Excludes ' + excluded.join(', ') + '.' : ''}`;
};
function updateRoomAvailability() {
  const form = $('#room-form'); if (!form) return;
  const edit = S.rooms.find(r => r.id === form.dataset.roomId);
  const full = nextRoomNumber(S.addFloor) === null && (!edit || edit.floor !== S.addFloor);
  $('#rnhint').textContent = floorHint(S.addFloor);
  $('#rn').disabled = full;
  form.querySelector('[type="submit"]').disabled = full;
}
const effectiveDark = () => S.theme ? S.theme === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
const applyTheme = () => { const h = document.documentElement; if (S.theme) h.setAttribute('data-theme', S.theme); else h.removeAttribute('data-theme'); };

/* ---------- accounts: phone numbers, passwords ---------- */
const normPhone = x => { let d = String(x).replace(/\D/g, ''); if (d.startsWith('63')) d = '0' + d.slice(2); return d; };
const validPhone = x => /^09\d{9}$/.test(normPhone(x));
const showPhone = x => x.length === 11 ? `${x.slice(0, 4)} ${x.slice(4, 7)} ${x.slice(7)}` : x;
const pwRules = x => [
  ['At least 6 characters', x.length >= 6],
  ['Include a letter and a number', /[A-Za-z]/.test(x) && /\d/.test(x)],
  ['No spaces', x.length > 0 && !/\s/.test(x)]
];
const normEmail = x => String(x).trim().toLowerCase();
// 'student' | 'faculty' | null. Only the two PUP web mail domains are accepted (no other domains or subdomains).
const emailKind = x => {
  const m = normEmail(x).match(/^[a-z0-9][a-z0-9._-]*@([a-z0-9.-]+)$/);
  return !m ? null : m[1] === WEBMAIL.student ? 'student' : m[1] === WEBMAIL.faculty ? 'faculty' : null;
};
const emailHint = `Students: @${WEBMAIL.student}. Faculty: @${WEBMAIL.faculty}.`;                 // plain text, for messages
const emailHintHtml = `Students: @${WEBMAIL.student}<br>Faculty: @${WEBMAIL.faculty}`;           // two lines, for hints under a field
/* ---------- icons ---------- */
const P = {
  archive:'<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8M9 12h6"/>',
  thermo: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
  drop: '<path d="M12 2.7s6 6.2 6 10.6a6 6 0 0 1-12 0C6 8.9 12 2.7 12 2.7z"/>',
  cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  fan: '<circle cx="12" cy="12" r="1.7"/><path d="M12 10.3c-1.7-3.3-1.3-7 1.6-7.2 2.5-.2 2.5 3.5-1.6 7.2z"/><path d="M12 10.3c-1.7-3.3-1.3-7 1.6-7.2 2.5-.2 2.5 3.5-1.6 7.2z" transform="rotate(120 12 12)"/><path d="M12 10.3c-1.7-3.3-1.3-7 1.6-7.2 2.5-.2 2.5 3.5-1.6 7.2z" transform="rotate(240 12 12)"/>',
  home: '<path d="M4 11.5 12 4l8 7.5V20H4z"/><path d="M10 20v-5h4v5"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.1"/>',
  device: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  sliders: '<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.9C3.8 8.7 2 12 2 12s3.6 7 10 7c1.5 0 2.8-.4 4-.9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5c2.1.7 3.5 2.6 3.5 5.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><path d="M12 19.5v.1"/>',
  sms: '<path d="M4 5h16v11H9l-5 4z"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19c3-5 6-8 10-10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  out: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  building: '<path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-5h6v5M9 9h.01M12 9h.01M15 9h.01M9 12.5h.01M12 12.5h.01M15 12.5h.01"/>',
  chevd: '<path d="M6 9l6 6 6-6"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'
};
const I = new Proxy({}, { get: (_, k) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${P[k] || ''}</svg>` });

const logo = (px, pinkOnly = false) => pinkOnly
  ? `<img class="logo" src="${LOGOS.pink}" alt="SafeZone logo" style="width:${px}px;height:${px}px">`
  : `<span class="logo logo-themed" style="width:${px}px;height:${px}px"><img class="logo-light" src="${LOGOS.red}" alt="SafeZone logo"><img class="logo-dark" src="${LOGOS.pink}" alt="SafeZone logo"></span>`;

/* =====================================================================
   ALERTS & VENTILATION LOGIC
   ===================================================================== */
const alertWatermarks = new Map();
function applyShared(shared, alerts) {
  S.limits = shared.thresholds; S.fanTrigger = shared.fanTrigger;
  const available = new Set(shared.rooms.map(r => String(r.id)));
  S.rooms = S.rooms.filter(r => available.has(r.id));
  for (const state of shared.rooms) {
    let room = S.rooms.find(r => r.id === String(state.id));
    if (!room) {
      room = makeRoom({ ...state, id: String(state.id), lightWatts: state.wattsPerLight });
      S.rooms.push(room);
    }
    Object.assign(room, { name: state.name, floor: state.floor, lights: state.lights, lightWatts: state.wattsPerLight, fanWatts: state.fanWatts });
    room.observed=true;room.updatedAt=state.updatedAt;
    room.reading = state.reading; room.levels = state.levels; room.electricity = state.electricity;
    room.devices = state.devices || []; room.lightsOn = state.lightsOn;
    room.vent = { mode: state.ventMode, on: state.fanOn }; room.scenario = state.scenario;
    if (room.buf.t[room.buf.t.length - 1] !== state.updatedAt) {
      room.buf.t.push(state.updatedAt);
      KEYS.forEach(k => room.buf[k].push(state.reading[k]));
      if (room.buf.t.length > 40) { room.buf.t.shift(); KEYS.forEach(k => room.buf[k].shift()); }
    }
  }
  if (S.rooms.length && !available.has(S.roomId)) S.roomId = S.rooms[0].id;
  if (shared.rooms.length) S.lastUpdate = Math.max(...shared.rooms.map(r => r.updatedAt));
  const scoped=alerts.filter(a=>String(a.roomId)===S.roomId);
  if(S.alertView==='archived'){S.alerts=scoped;return;}
  const latest=Math.max(0,...scoped.map(a=>a.id));
  const previous=alertWatermarks.get(S.roomId);
  const fresh=previous===undefined?[]:scoped.filter(a=>a.id>previous && ['warning','exceeded'].includes(a.type));
  if (S.screen!=='alerts' && fresh.length) {
    S.unread+=fresh.length;
    toast(`${cur().name}: ${fresh.length===1?fresh[0].title.replace(/^Demo:\s*/, ''):fresh.length+' new condition alerts'}`);
  }
  alertWatermarks.set(S.roomId,Math.max(previous||0,latest));
  S.alerts=scoped;
}
let polling = false;
async function pollShared() {
  if (!token || !S.role || polling) return;
  polling = true;
  const session = token; const requestedRoom=S.roomId,requestedView=S.alertView;
  try {
    const [shared, alerts] = await Promise.all([api('/simulation'), api(alertUrl(requestedRoom))]);
    if (token !== session || !S.role || requestedRoom!==S.roomId || requestedView!==S.alertView) return;
    S.archiveAvailable=alerts.archiveAvailable===true;
    applyShared(shared, alerts.alerts); S.syncError = '';
    if(S.screen==='analytics'&&!S.temperatureAnalytics.loading&&Date.now()-S.temperatureAnalytics.fetchedAt>=30000)void loadTemperatureAnalytics();
    if (LIVE.has(S.screen)) render();
    else { const bar = $('nav.nav'); if (bar) bar.outerHTML = nav(); }
  } catch (err) {
    if (token === session && S.role) {
      if (!S.syncError) toast('Shared readings could not refresh. Reconnecting…');
      S.syncError = err.message;
      if (LIVE.has(S.screen)) render();
    }
  } finally { polling = false; }
}

/* =====================================================================
   SIMULATOR (replace with real data)
   ===================================================================== */
const roomBase = r => ({ temp: BASE.temp + r.off.temp, hum: BASE.hum + r.off.hum, co2: BASE.co2 + r.off.co2 });
const roomLevel = r => ['normal', 'warning', 'exceeded'][Math.max(...KEYS.map(k => RANK[r.levels[k]]))];
const num = (v, d) => (v != null && !isNaN(v)) ? v : d;

// One room = its own readings, alert levels, fan, and power numbers.
function makeRoom(cfg) {
  const id = cfg.id || 'r' + hashStr(String(cfg.name).toLowerCase());
  const rnd = mulberry(hashStr(id));
  const r = {
    id, name: cfg.name, floor: cfg.floor || guessFloor(cfg.name),
    lights: num(cfg.lights, ROOM_DEFAULTS.lights), lightWatts: num(cfg.lightWatts, ROOM_DEFAULTS.lightWatts), fanWatts: num(cfg.fanWatts, ROOM_DEFAULTS.fanWatts),
    off: { temp: (rnd() - 0.5) * 1.6, hum: (rnd() - 0.5) * 6, co2: (rnd() - 0.5) * 160 },   // makes each room look a bit different
    other: 50 + rnd() * 90,
    vent: { mode: cfg.mode === 'manual' ? 'manual' : 'auto', on: false }, scenario: null, simStart: null,
    levels: { temp: 'normal', hum: 'normal', co2: 'normal' }, prevWorst: 0,
    buf: { t: [], temp: [], hum: [], co2: [] }
  };
  r.lightsOn = Math.round(r.lights * 0.75);
  r.reading = roomBase(r);
  return r;
}

/* History includes only samples received during this browser session. */
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function history(k, range) {
  const buf=cur().buf, cutoff=Date.now()-({'6h':6,'24h':24,'7d':168}[range]||6)*3600000;
  const vals=[],labels=[];
  buf.t.forEach((ts,i)=>{if(ts>=cutoff && Number.isFinite(Number(buf[k][i]))){vals.push(Number(buf[k][i]));labels.push(tShort(new Date(ts)));}});
  return {vals,labels};
}

/* =====================================================================
   CHART (inline SVG)
   ===================================================================== */
function chartSVG(vals, labels, k, cls, id) {
  if(!vals.length)return '<p class="empty">Waiting for recorded readings.</p>';
  const m = METRICS[k]; const th = S.limits[k];
  const W = 340, H = 190, L = 42, R = 10, T = 12, B = 26;
  let lo = Math.min(m.axis[0], ...vals), hi = Math.max(m.axis[1], ...vals, th.limit);
  lo = Math.floor(lo / m.step) * m.step; hi = Math.ceil(hi / m.step) * m.step;
  const x = i => L + (W - L - R) * (vals.length > 1 ? i / (vals.length - 1) : 0.5);
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let grid = '';
  for (let v = lo; v <= hi + 1e-9; v += m.step) {
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="ax" x="${L - 7}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${v.toLocaleString('en-US')}</text>`;
  }
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = 'M' + pts.join(' L');
  const area = `${line} L${x(vals.length - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`;
  const ref = (v, c) => (v > lo && v < hi) ? `<line class="${c}" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>` : '';
  const n = labels.length; const idx = [0, Math.round((n - 1) / 3), Math.round(2 * (n - 1) / 3), n - 1];
  const anchors = ['start', 'middle', 'middle', 'end'];
  const xl = idx.map((ix, j) => `<text class="ax" x="${j === 0 ? L : j === 3 ? W - R : x(ix).toFixed(1)}" y="${H - 7}" text-anchor="${anchors[j]}">${esc(labels[ix] || '')}</text>`).join('');
  return `<svg class="chart ${cls}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${m.label} trend chart">
    <defs><linearGradient id="g-${id}" x1="0" y1="0" x2="0" y2="1"><stop class="stopc" offset="0" stop-opacity=".28"/><stop class="stopc" offset="1" stop-opacity="0"/></linearGradient></defs>
    ${grid}${ref(th.warn, 'wrn')}${ref(th.limit, 'lim')}
    <path d="${area}" fill="url(#g-${id})"/><path class="line" d="${line}"/>${xl}</svg>`;
}
const legend = k => `<div class="legend"><span><i style="color:#E5B800"></i>Warning ${withUnit(k, S.limits[k].warn)}</span><span><i style="color:var(--bad)"></i>Limit ${withUnit(k, S.limits[k].limit)}</span></div>`;

/* =====================================================================
   VIEWS
   ===================================================================== */
const LIVE = new Set(['home', 'alerts', 'monitor', 'status', 'rooms', 'analytics']);
const TITLES = { alerts: 'Alerts', monitor: 'Monitoring', status: 'Device Status', settings: 'Settings', about: 'About', users: 'Manage Users', students: 'Student Accounts', rooms: 'Classroom Overview', analytics: 'Temperature Analytics' };

function nav() {
  const items = S.role === 'admin'
    ? [['home', 'Home', 'home'], ['alerts', 'Alerts', 'bell'], ['monitor', 'Monitoring', 'chart'], ['status', 'Devices', 'device'], ['settings', 'Settings', 'sliders']]
    : [['home', 'Home', 'home'], ['alerts', 'Alerts', 'bell'], ['monitor', 'Monitoring', 'chart'], ['about', 'About', 'info']];
  return `<nav class="nav" style="--n:${items.length}" aria-label="Main">${items.map(([id, label, ic]) =>
    `<button data-act="go" data-v="${id}" ${(S.screen === id || (['rooms','analytics'].includes(S.screen) && id==='monitor') || (['users','students'].includes(S.screen) && id === 'settings')) ? 'aria-current="page"' : ''}>${I[ic]}${label}${id === 'alerts' && S.unread ? `<span class="badge" aria-label="${S.unread} new">${S.unread > 9 ? '9+' : S.unread}</span>` : ''}</button>`).join('')}</nav>`;
}

function topbar() {
  const home = S.screen === 'home'; const back = ['rooms','analytics'].includes(S.screen)?'monitor':S.screen==='students'?'users': ['about', 'users'].includes(S.screen) && S.role === 'admin' ? 'settings' : 'home';
  return `<header class="topbar">${home
    ? `${logo(34)}<h1>SafeZone</h1>`
    : `<button data-act="${S.screen==='students' && S.studentCourse!==null?'studentsBack':'go'}" data-v="${back}" aria-label="${S.screen==='students' && S.studentCourse!==null?(S.studentSection!==null?'Back to sections':'Back to courses'):'Back to '+back}">${I.back}</button><h1>${TITLES[S.screen]}</h1>`}
    <button data-act="menu" aria-label="Menu">${I.menu}</button></header>`;
}

function sensorCard(k) {
  const m = METRICS[k]; const lv = S.levels[k];
  return `<article class="card sensor"><div class="s-head"><span class="ico ico-${k}">${I[m.icon]}</span>${m.label}</div>
    <div class="s-val">${fmt(k, S.reading[k])}<small>${m.unit}</small></div><span class="chip ${lv}">${LV[lv]}</span></article>`;
}

// control = true only on the Monitoring screen. Everywhere else the card just shows the status.
function ventCard(control) {
  const on = S.vent.on; const auto = S.vent.mode === 'auto'; const admin = S.role === 'admin';
  const foot = control && admin
    ? `<button class="switch" role="switch" aria-checked="${on}" aria-label="Exhaust fan" data-act="toggleVent"><span></span></button>
       ${auto ? '<p class="s-note">Automatic mode</p>' : '<button class="linkbtn" data-act="auto">Manual. Switch to automatic</button>'}`
    : `<span class="chip ${on ? 'normal' : 'idle'}">${auto ? 'Automatic' : 'Manual'}</span>`;
  return `<article class="card sensor ${control && admin?'fan-control-card':''}"><div class="s-head"><span class="ico ico-fan ${on ? 'spin' : ''}">${I.fan}</span>Exhaust fan</div>
    <div class="s-val">${on ? 'ON' : 'OFF'}</div><p class="s-note fan-count">${(cur().devices || []).filter(d => d.type === 'exhaust_fan').reduce((n,d) => n+d.quantity,0)} exhaust fan(s)</p><div class="fan-card-controls">${foot}</div></article>`;
}

function cards(control = false) { return `<div class="grid2">${sensorCard('temp')}${sensorCard('hum')}${sensorCard('co2')}${ventCard(control)}</div>`; }

function banner() {
  const w = worstName();
  const map = {
    normal: ['leaf', 'Environment Healthy', 'Good air quality and safe conditions.'],
    warning: ['alert', 'Readings Rising', 'One or more readings are near the set limit.'],
    exceeded: ['alert', 'Danger: Limit Exceeded', S.vent.on ? 'The exhaust fan is on and clearing the air.' : 'The exhaust fan is off. Turn it on or open a window.']
  }[w];
  return `<div class="banner ${w}" role="status">${I[map[0]]}<div><b>${map[1]}</b><span>${map[2]}</span></div></div>`;
}

const liveLine = () => `<div class="live"><i></i>Live, updated ${tSec(new Date(S.lastUpdate))}</div>`;

// "Select Room" dropdown. Admins also get the Add Room button.
function roomBar(allowAdd = false) {
  const admin = S.role === 'admin'; const r = cur();
  if (S.rooms.length < 2 && !admin) return '';
  return `<div class="roombar">
    <button class="roompick" data-act="pickRoom" aria-haspopup="dialog" aria-label="Select room. Now showing ${esc(r.name)}, ${floorName(r.floor)}">
      <span class="rp-ico">${I.building}</span>
      <span class="rp-txt"><small>Select Room, ${floorName(r.floor)}</small><b>${esc(r.name)}</b></span>
      <i class="rdot ${roomLevel(r)}"></i><span class="rp-chev">${I.chevd}</span></button>
    ${admin && allowAdd && S.screen === 'monitor' ? `<button class="addroom" data-act="addRoom" aria-label="Add room"><span class="plus">${I.plus}</span><small>Add Room</small></button>` : ''}
  </div>`;
}

function powerCard(compact, monitor = false) {
  const r = cur(); const e = r.electricity || { totalKwh: 0, lightsKwh: 0, fanKwh: 0 };
  if (monitor) return `<article class="card power monitor-energy"><div class="s-head"><span class="ico ico-pow">${I.bolt}</span>Electricity</div><div class="s-val">${Number(e.fanKwh).toFixed(4)}<small>kWh</small></div><p class="s-note">Estimated fan usage</p></article>`;
  if (compact) {
    return `<button class="card power compact" data-act="toMonitor" aria-label="Electricity, open monitoring"><span class="ico ico-pow">${I.bolt}</span>
      <div><b>${energyText(e.fanKwh)}</b><span>Estimated fan electricity</span></div><span class="chev" style="margin-left:auto">${I.chev}</span></button>`;
  }
  return `<article class="card power"><div class="s-head"><span class="ico ico-pow">${I.bolt}</span>Estimated electricity usage</div>
    <div class="s-val">${Number(e.fanKwh).toFixed(4)}<small>kWh</small></div>
    <p class="note">Exhaust fan estimate from configured ratings and simulated operating time.</p>
    <div class="plist">
      <div>${I.fan}<span>Exhaust fan<small>${r.vent.on ? 'Running' : 'Off'}</small></span><b>${energyText(e.fanKwh)}</b></div>
    </div></article>`;
}

function legendCard() {
  const warnFan = S.fanTrigger === 'warning';
  return `<section class="card legend-card"><h3>Status colors</h3>
    <div class="lg"><i class="dot normal"></i><div><b>Green: Normal</b><span>Readings are within the set limits.</span></div></div>
    <div class="lg"><i class="dot warning"></i><div><b>Yellow: Warning</b><span>Near the limit. SMS delivery is not connected.${warnFan ? ' The exhaust fan turns ON.' : ''}</span></div></div>
    <div class="lg"><i class="dot exceeded"></i><div><b>Red: Danger</b><span>Limit exceeded. SMS delivery is not connected.${warnFan ? ' The exhaust fan stays ON.' : ' The exhaust fan turns ON.'}</span></div></div>
    <p class="legend-foot">In automatic mode, the exhaust fan turns OFF again when every reading is green.</p></section>`;
}

function monitoringLinks() {
  return `<div class="monitor-links"><button class="card" data-act="go" data-v="rooms">${I.building}<span><b>All classrooms</b><small>Temperature, CO₂ and room status</small></span>${I.chev}</button><button class="card" data-act="go" data-v="analytics">${I.chart}<span><b>Temperature analytics</b><small>Rooms with frequent temperature limit alerts</small></span>${I.chev}</button></div>`;
}
function readingStatus(value,limits) {
  if(!Number.isFinite(Number(value))||value==null)return 'unknown';
  return Number(value)>=limits.limit?'exceeded':Number(value)>=limits.warn?'warning':'normal';
}
function overviewStatus(room,limits) {
  if(!room.observed)return 'unknown';
  const levels=['temp','co2'].map(k=>readingStatus(room.reading[k],limits[k]));
  return levels.includes('unknown')?'unknown':levels.includes('exceeded')?'exceeded':levels.includes('warning')?'warning':'normal';
}
function overviewView() {
  const rooms=S.rooms.filter(r=>S.overviewFloor==='all'||r.floor===Number(S.overviewFloor));
  return `<p class="note">Current simulated readings. Status uses the more severe temperature or CO₂ level.</p><label class="f" for="overview-floor">Floor</label><select id="overview-floor"><option value="all">All floors</option>${floorList().map(f=>`<option value="${f}" ${String(f)===S.overviewFloor?'selected':''}>${floorName(f)}</option>`).join('')}</select><div class="room-table-scroll" role="region" aria-label="Classroom readings" tabindex="0"><table class="room-overview-table"><caption>Classroom environmental readings</caption><thead><tr><th scope="col">Room Number</th><th scope="col">Temperature</th><th scope="col">Carbon Dioxide (CO₂)</th><th scope="col">Status</th></tr></thead><tbody>${rooms.map(r=>{const status=overviewStatus(r,S.limits);return `<tr class="room-state-${status}"><th scope="row"><button class="linkbtn" data-act="monitorRoom" data-v="${r.id}">${esc(r.name)}</button></th><td>${r.observed&&r.reading.temp!=null?withUnit('temp',Number(r.reading.temp)):'—'}</td><td>${r.observed&&r.reading.co2!=null?withUnit('co2',Number(r.reading.co2)):'—'}</td><td><span class="chip ${status}">${status==='unknown'?'Awaiting data':LV[status]}</span></td></tr>`;}).join('')}</tbody></table></div><p class="note">Green: Normal · Yellow: Warning · Red: Danger. Open a room to view its charts.</p>`;
}
let analyticsRequest = 0;
async function loadTemperatureAnalytics() {
  const request=++analyticsRequest,session=token,range=S.temperatureAnalytics.range;
  const state=S.temperatureAnalytics;state.loading=true;state.error='';state.fetchedAt=Date.now();
  if(S.screen==='analytics')render();
  try {
    const data=await api('/alerts/temperature-analytics?range='+encodeURIComponent(range));
    if(request!==analyticsRequest||token!==session||S.temperatureAnalytics!==state)return;
    state.data=data;
  }catch(error){if(request===analyticsRequest&&token===session&&S.temperatureAnalytics===state)state.error=error.message;}
  finally{if(request===analyticsRequest&&token===session&&S.temperatureAnalytics===state){state.loading=false;if(S.screen==='analytics')render();}}
}
function analyticsView() {
  const state=S.temperatureAnalytics,ranked=(state.data?.rooms||[]).filter(r=>r.alertCount>0);
  const ranges=[['7d','Last 7 days'],['30d','Last 30 days'],['all','All time']];
  const controls=`<div class="mini-chips" role="group" aria-label="Analytics period">${ranges.map(([id,label])=>`<button data-act="analyticsRange" data-v="${id}" aria-pressed="${state.range===id}">${label}</button>`).join('')}</div>`;
  const intro=`<h2>Rooms with frequent temperature alerts</h2><p class="sub">Ranked by the number of recorded alerts that reached or exceeded the temperature limit.</p>${controls}`;
  if(state.error)return `${intro}<p class="note" role="alert">Temperature alert history could not load. ${esc(state.error)}</p><button class="btn soft" data-act="analyticsRetry">Try again</button>`;
  if(!state.data)return `${intro}<p class="empty" role="status">${state.loading?'Loading temperature alert history…':'Temperature alert history has not loaded yet.'}</p>`;
  return `${intro}<div class="analytics-summary"><div><b>${state.data.totalAlerts}</b><span>Temperature limit alerts</span></div><div><b>${ranked.length}</b><span>Rooms with limit alerts</span></div></div>
    <p class="note">Includes archived and demo alerts. Cautions and other sensor alerts are excluded.</p>
    ${state.loading?'<p class="note" role="status">Updating alert history…</p>':''}
    <div class="temperature-ranking">${ranked.map((r,index)=>`<button class="card temperature-rank alert-frequency-rank" data-act="monitorRoom" data-v="${r.roomId}">
      <span class="rank-number">${index+1}</span><span class="rank-room"><b>${esc(r.room)}</b><small>${floorName(r.floor)} · ${r.alertDays} day${r.alertDays===1?'':'s'} with alerts</small><small>Latest: ${r.lastAlertAt?esc(new Date(r.lastAlertAt).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})):'—'}</small></span>
      <span class="rank-reading"><b>${r.alertCount}</b><small>limit alert${r.alertCount===1?'':'s'}</small></span></button>`).join('') || '<p class="empty">No temperature limit alerts were recorded for this period.</p>'}</div>
    <p class="note">Counts represent logged events and depend on how long each room has been monitored. Select a room to open Monitoring.</p>`;
}

function homeView() {
  const room = esc(cur().name);
  const head = S.role === 'admin'
    ? `<h2>Welcome, Admin!</h2><p class="sub">Here's the current environment in ${room} and the system status.</p>`
    : `<h2>Classroom Environment</h2><p class="sub">Real-time indoor conditions in ${room}.</p>`;
  return `${head}${roomBar()}${liveLine()}${cards()}${FEATURES.fanEnergy?powerCard(true):''}${banner()}${legendCard()}`;
}

function groupRoomAlerts(alerts, roomId) {
  const days=new Map();
  const eventKey=a=>{
    const metric=a.metric || (/temperature/i.test(a.title)?'temp':/humidity/i.test(a.title)?'hum':/co[₂2]/i.test(a.title)?'co2':null);
    return metric && ['warning','exceeded'].includes(a.type)?'threshold:'+metric:a.type+':'+a.title;
  };
  const severity=a=>a.type==='exceeded'?2:a.type==='warning'?1:0;
  for(const alert of alerts.filter(a=>String(a.roomId)===String(roomId)).slice().sort((a,b)=>b.ts-a.ts || b.id-a.id)) {
    const date=new Date(alert.ts);
    const key=[date.getFullYear(),date.getMonth()+1,date.getDate()].join('-');
    if(!days.has(key))days.set(key,{key,ts:alert.ts,times:new Map()});
    const minute=Math.floor(alert.ts/60000),day=days.get(key);
    if(!day.times.has(minute))day.times.set(minute,{ts:alert.ts,items:[]});
    const time=day.times.get(minute);
    const index=time.items.findIndex(item=>eventKey(item)===eventKey(alert));
    if(index<0)time.items.push({...alert,sourceIds:[alert.id]});
    else {const sourceIds=[...time.items[index].sourceIds,alert.id];if(severity(alert)>severity(time.items[index]))time.items[index]={...alert,sourceIds};else time.items[index].sourceIds=sourceIds;}
  }
  return [...days.values()].map(day=>({...day,times:[...day.times.values()]}));
}
function alertDescription(alert) {
  const metric=alert.metric || (/temperature/i.test(alert.title)?'temp':/humidity/i.test(alert.title)?'hum':/co[₂2]/i.test(alert.title)?'co2':null);
  const label={temp:'temperature',hum:'relative humidity',co2:'carbon dioxide (CO₂) concentration'}[metric];
  if(label && ['warning','exceeded'].includes(alert.type)) {
    const danger=alert.type==='exceeded';
    const recorded=alert.value!=null && Number.isFinite(Number(alert.value))?withUnit(metric,Number(alert.value)):null;
    // Use thresholds saved in this event's body, never today's possibly changed settings.
    const match=String(alert.body || '').match(danger?/limit:\s*(-?\d+(?:\.\d+)?)/i:/warning:\s*(-?\d+(?:\.\d+)?)/i);
    const threshold=match?withUnit(metric,Number(match[1])):null;
    const status=danger?'Threshold alert':'Caution';
    const reading=recorded?`The recorded ${label} was ${recorded}. `:`The ${label} reading `;
    return `${status}: ${reading}${recorded?'This reading ':''}reached or exceeded the configured ${danger?'limit':'warning threshold'}${threshold?' of '+threshold:''}.`;
  }
  if(alert.type==='normal')return 'Room conditions returned to normal. Temperature, relative humidity, and carbon dioxide readings were within their configured normal ranges.';
  if(alert.type==='ventilation') {
    const off=/stopped|off/i.test(alert.title);
    return `The exhaust fan was ${off?'deactivated':'activated'}.${/no hardware command/i.test(alert.body || '')?' This was a simulated status change; no physical hardware command was issued.':''}`;
  }
  return alert.title.replace(/^Demo:\s*/,'').replace(/[.!?]+$/,'')+'.';
}
function alertTimeline(alerts) {
  return groupRoomAlerts(alerts,S.roomId).map(day=>`<section class="alert-day"><h3>${esc(new Date(day.ts).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}))}</h3>
    ${day.times.map(time=>`<article class="alert-time-block"><h4><time datetime="${new Date(time.ts).toISOString()}">${esc(new Date(time.ts).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}).replace(/\s/g,'').toLowerCase())}</time></h4>
      <div class="alert-time-events">${time.items.map(a=>`<div class="alert ${a.type}"><div class="alert-content"><p>${esc(alertDescription(a))}</p></div>${S.archiveAvailable?`<button type="button" class="x alert-archive-action" data-act="archiveAlert" data-v="${a.sourceIds.join(',')}" data-restore="${S.alertView==='archived'}" aria-label="${S.alertView==='archived'?'Restore alert':'Archive alert'}" title="${S.alertView==='archived'?'Restore alert':'Archive alert'}">${S.alertView==='archived'?I.back:I.archive}</button>`:''}</div>`).join('')}</div>
    </article>`).join('')}</section>`).join('');
}
function alertsView() {
  const scoped=S.alerts.filter(a=>String(a.roomId)===S.roomId);
  const filters=[['all','All alerts'],['warning','Caution'],['exceeded','Danger'],['system','Updates']];
  const list=scoped.filter(a=>S.alertFilter==='all'||(S.alertFilter==='system'?!['warning','exceeded'].includes(a.type):a.type===S.alertFilter));
  return `<div class="alerts-context"><p class="section-label">Alerts for ${esc(cur().name)}</p>${roomBar()}<div class="seg archive-tabs" role="group" aria-label="Alert list"><button data-act="alertView" data-v="active" aria-pressed="${S.alertView==='active'}">Current</button><button data-act="alertView" data-v="archived" aria-pressed="${S.alertView==='archived'}">Archive</button></div><div class="chips" role="group" aria-label="Filter alerts">${filters.map(([id,label])=>`<button data-act="filter" data-v="${id}" aria-pressed="${S.alertFilter===id}">${label}</button>`).join('')}</div></div>
    <p class="note">Simulated readings · SMS delivery is not connected.</p>
    ${S.alertView==='archived'?'<p class="note">Your archived alerts. Restore an alert to return it to Current. Records are never deleted.</p>':''}
    ${S.alertView==='archived'&&!S.archiveAvailable?'<p class="empty">Archive is temporarily unavailable. Please contact an administrator.</p>':alertTimeline(list) || '<p class="empty">No alerts in this group for this room.</p>'}`;
}

function metricChips() {
  return `<div class="mini-chips" role="group" aria-label="Choose reading">${KEYS.map(k => `<button data-act="metric" data-v="${k}" aria-pressed="${S.mon.metric === k}">${METRICS[k].label}</button>`).join('')}</div>`;
}

function monitorView() {
  const k = S.mon.metric; const m = METRICS[k]; const live = S.mon.view === 'live';
  const seg = `<div class="seg" role="group" aria-label="View"><button data-act="view" data-v="live" aria-pressed="${live}">Real-time</button><button data-act="view" data-v="history" aria-pressed="${!live}">History</button></div>`;
  if (live) {
    const labels = S.buf.t.map(t => tSec(new Date(t)));
    return `<div class="monitor-room-context">${roomBar(true)}${seg}</div><div class="monitor-utilities ${FEATURES.fanEnergy?'':'fan-only'}">${ventCard(true)}${FEATURES.fanEnergy?powerCard(false,true):''}</div>${metricChips()}
      <section class="card chart-card" style="margin-top:0"><div class="chart-head"><h3>${m.label}: ${withUnit(k,S.reading[k])}</h3><span class="chip ${S.levels[k]}">${LV[S.levels[k]]}</span></div>
      ${chartSVG(S.buf[k], labels, k, S.levels[k], 'live')}${legend(k)}</section>${monitoringLinks()}`;
  }
  const r = S.mon.range; const h = history(k, r);
  const min = Math.min(...h.vals), max = Math.max(...h.vals), avg = h.vals.reduce((a, b) => a + b, 0) / h.vals.length;
  const over = h.vals.filter(v => v >= S.limits[k].limit).length;
  const rc = `<div class="mini-chips" role="group" aria-label="Time range">${[['6h', 'Last 6 hours'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days']].map(([id, l]) => `<button data-act="range" data-v="${id}" aria-pressed="${r === id}">${l}</button>`).join('')}</div>`;
  return `<div class="monitor-room-context">${roomBar(true)}${seg}</div>${metricChips()}${rc}
    <section class="card"><div class="chart-head"><h3>${m.label} (${m.unit})</h3></div>${chartSVG(h.vals, h.labels, k, 'neutral', 'hist')}${legend(k)}</section>
    <div class="stats"><div class="stat"><span>Lowest</span><b>${h.vals.length?fmt(k,min):'—'}</b></div><div class="stat"><span>Average</span><b>${h.vals.length?fmt(k,avg):'—'}</b></div><div class="stat"><span>Highest</span><b>${h.vals.length?fmt(k,max):'—'}</b></div></div>
    <p class="note">Simulated samples received during this browser session only; up to 40 recent readings per room are retained. Earlier history is not available. Actual conditions vary with weather, occupancy and ventilation.</p><p class="note">${!h.vals.length?'No recorded samples yet.':over ? `${over} reading${over > 1 ? 's' : ''} reached the limit in this period.` : 'No readings reached the limit in this period.'}</p>${monitoringLinks()}`;
}

const DEVICE_NAMES = {exhaust_fan:'Exhaust fan',esp8266:'NodeMCU V3 ESP8266',temp_sensor:'Temperature sensor',hum_sensor:'Humidity sensor',co2_sensor:'CO₂ sensor',wifi:'Wi-Fi module',sms_module:'SMS module',power_meter:'Electricity meter'};
const FAN_NAMES = {unspecified:'Not specified',wall:'Wall-mounted',window:'Window-mounted',ceiling:'Ceiling-mounted',inline:'Inline duct'};
function statusView() {
  const devices = (cur().devices || []).filter(d => d.type !== 'light' && (FEATURES.fanEnergy || d.type !== 'power_meter'));
  return `<h2>Room devices</h2><p class="sub">Configured devices for ${esc(cur().name)}.</p>${roomBar()}
    <div class="list">${devices.map(d => `<div class="row"><span class="r-ico">${I[d.type === 'light' ? 'bulb' : d.type === 'exhaust_fan' ? 'fan' : 'device']}</span>
      <div class="r-txt"><b>${esc(d.label)}</b><span>${d.quantity} × ${esc(DEVICE_NAMES[d.type])}${d.type === 'exhaust_fan' ? ' · ' + esc(FAN_NAMES[d.fanType] || 'Not specified') : ''}${d.wattsPerDevice ? ' · ' + d.wattsPerDevice + ' W each' : ''}</span></div>
      <span class="pill">${d.type === 'exhaust_fan' ? (S.vent.on ? 'Running' : 'Off') : d.type === 'light' ? d.activeQuantity + ' on' : 'Configured'}</span></div>`).join('') || '<p class="empty">No devices configured.</p>'}</div>`;
}

function limitBlock(k, hint) {
  const m = METRICS[k]; const t = S.limits[k];
  return `<details class="row-d"><summary><span class="r-ico row" style="width:36px;height:36px;padding:0;border:0;justify-content:center;border-radius:11px;background:var(--brand-soft);color:var(--nav-active)">${I[m.icon]}</span>
    <div class="r-txt"><b>${m.label} Threshold</b><span>${hint}</span></div><span class="chev">${I.chev}</span></summary>
    <div class="fields"><label class="f">Warning at (${m.unit})<input type="number" id="${k}-warn" value="${t.warn}" step="any" inputmode="decimal"></label>
    <label class="f">Limit at (${m.unit})<input type="number" id="${k}-limit" value="${t.limit}" step="any" inputmode="decimal"></label></div></details>`;
}

function roomConfiguration() {
  const room = S.rooms.find(r => r.id === S.configRoomId) || S.rooms[0];
  S.configRoomId = room.id;
  return `<section class="room-configuration" aria-label="Room configuration">
    <label class="f" for="config-floor">Floor</label>
    <select id="config-floor" aria-label="Floor to configure">${floorList().filter(f=>roomsOn(f).length).map(f=>`<option value="${f}" ${f===room.floor?'selected':''}>${floorName(f)}</option>`).join('')}</select>
    <label class="f" for="config-room">Room</label>
    <select id="config-room" aria-label="Room to configure">${roomsOn(room.floor).map(r => `<option value="${esc(r.id)}" ${r.id === room.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
    <div class="room-config-actions"><button class="btn soft small" id="config-room-edit" data-act="editRoom" data-v="${room.id}">${I.edit} Edit room</button>
      <button class="btn soft small" id="config-room-delete" data-act="roomDel" data-v="${room.id}">${I.trash} Delete room</button></div>
  </section>`;
}

function settingsView() {
  const trig = S.draftTrigger;
  return `<div class="settings-layout"><h2>Administration</h2><p class="sub">Manage accounts, rooms and environmental thresholds.</p><p class="section-label" style="margin-top:0">Admin account</p>
    <div class="list">
      <button class="row" data-act="users"><span class="r-ico">${I.users}</span><div class="r-txt"><b>Manage Users</b><span>Admins and registered accounts</span></div><span class="chev">${I.chev}</span></button>
      <button class="row" data-act="account"><span class="r-ico">${I.user}</span><div class="r-txt"><b>Account Settings</b><span>Username and password</span></div><span class="chev">${I.chev}</span></button>
    </div>
    ${roomConfiguration()}
    <p class="section-label">Alerts</p>
    <div class="list">
      <button class="row" data-act="sms"><span class="r-ico">${I.sms}</span><div class="r-txt"><b>SMS Alerts</b><span>Name, role and mobile number of each recipient</span></div><span class="chev">${I.chev}</span></button>
    </div>
    <p class="section-label">Help</p>
    <div class="list">
      <button class="row" data-act="go" data-v="about"><span class="r-ico">${I.info}</span><div class="r-txt"><b>About SafeZone</b><span>System overview and features for admins</span></div><span class="chev">${I.chev}</span></button>
    </div>
    <p class="section-label">System settings</p>
    <div class="list">
      ${limitBlock('temp', 'Set the warning and limit')}
      ${limitBlock('hum', 'Set the warning and limit')}
      ${limitBlock('co2', 'Set the warning and limit')}
      <div class="row"><span class="r-ico">${I.fan}</span><div class="r-txt"><b>Exhaust fan control</b><span>Automatic or manual, for all rooms</span></div>
        <button class="switch" role="switch" id="draft-auto" aria-checked="${S.draftAuto}" aria-label="Automatic ventilation" data-act="draftAuto"><span></span></button></div>
      <div class="row" style="flex-wrap:wrap"><span class="r-ico">${I.fan}</span><div class="r-txt"><b>Turn fan on at</b><span>When automatic ventilation starts</span></div>
        <div class="mini-chips opt2" role="group" aria-label="Turn fan on at" style="flex-basis:100%;margin:0">
          <button data-act="trigger" data-v="warning" aria-pressed="${trig === 'warning'}">Yellow (Warning)</button>
          <button data-act="trigger" data-v="exceeded" aria-pressed="${trig === 'exceeded'}">Red (Danger)</button></div></div>
    </div>
    <div style="margin-top:16px"><button class="btn" data-act="save">Save changes</button></div>
    <p class="section-label">Shared demo tools</p>
    <p class="note">Everyone connected to this server can see the selected rooms change. Hardware and SMS are not connected.</p>
    <label class="f">Rooms to affect<select id="sim-scope" aria-label="Rooms to affect">
      ${S.rooms.map(r => `<option value="${r.id === S.roomId ? 'current' : 'room:'+r.id}" ${(S.simScope === 'current' && r.id === S.roomId) || S.simScope === 'room:'+r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
      <option value="selected" ${S.simScope === 'selected' ? 'selected' : ''}>Select multiple rooms</option>
      <option value="all" ${S.simScope === 'all' ? 'selected' : ''}>All rooms</option>
    </select></label>
    <details id="sim-room-options" ${S.simScope !== 'selected' ? 'hidden' : ''} class="room-multiselect">
      <summary>Select rooms <span id="sim-room-count">(${S.simSelected.length} selected)</span></summary>
      <div class="room-checkboxes">
        ${S.rooms.map(r => `<label><input type="checkbox" class="sim-room" value="${esc(r.id)}" ${S.simSelected.includes(String(r.id)) ? 'checked' : ''}> <span>${esc(r.name)}</span></label>`).join('')}
      </div>
    </details>
    <div class="stack">
      <button class="btn soft small" data-act="sim" data-v="co2">Simulate high CO₂</button>
      <button class="btn soft small" data-act="sim" data-v="temp">Simulate high temperature</button>
      <button class="btn soft small" data-act="sim" data-v="hum">Simulate high humidity</button>
      <button class="btn soft small" data-act="sim" data-v="reset">Reset readings</button>
    </div></div>`;
}

// About: system overview and features. One version for students/faculty and one for admins.
function aboutView() {
  const admin = S.role === 'admin';
  const d = (ic, t, sub, body, open) => `<details class="row-d"${open ? ' open' : ''}><summary><span class="r-ico">${I[ic]}</span><div class="r-txt"><b>${t}</b><span>${sub}</span></div><span class="chev">${I.chev}</span></summary><div class="detail-body">${body}</div></details>`;

  const colors = `<h4>Status colors</h4><ul>
    <li><b>Green, Normal:</b> readings are within the normal range.</li>
    <li><b>Yellow, Warning:</b> a reading has reached the warning level.</li>
    <li><b>Red, Danger:</b> a reading has reached the danger level.</li></ul>`;

  const overview = admin ? `<p>SafeZone is an IoT-based classroom environmental monitoring system. As an admin you can watch every room, control the ventilation, and manage who can use the system and who receives alerts.</p>
    <h4>How it works</h4><ol>
      <li>Sensors in the classroom measure temperature, humidity and CO₂.</li>
      <li>The readings are compared with the limits you set in Settings.</li>
      <li>The room status is set to green, yellow or red.</li>
      <li>In Automatic mode the fan turns on by itself at the level you choose, yellow or red. In Manual mode you switch it in Monitoring.</li>
      <li>Readings are saved to the cloud and shown in this app.</li>
      <li>At Warning or Danger, SMS alerts go to everyone switched on in SMS Alerts.</li></ol>
    ${colors}
    <h4>Good to know</h4><ul>
      <li>After switching the fan manually, check the ventilation status to confirm it changed.</li>
      <li>Only the classroom with the installed prototype shows live sensor readings. Other rooms are for future expansion.</li>
      <li>Keep each recipient's mobile number correct. SMS alerts need a cellular network.</li></ul>`
  : `<p>SafeZone is an IoT-based classroom environmental monitoring system. It tracks the temperature, humidity and carbon dioxide (CO₂) in a classroom, turns on an exhaust fan automatically when the air becomes unhealthy, and sends SMS alerts.</p>
    <h4>How it works</h4><ol>
      <li>Sensors in the classroom measure temperature, humidity and CO₂.</li>
      <li>The readings are compared with preset limits.</li>
      <li>The classroom status is set to green, yellow or red.</li>
      <li>The exhaust fan turns on when the required limit is reached.</li>
      <li>Readings are saved to the cloud and shown in this app.</li>
      <li>At Warning or Danger, SMS alerts are sent to registered mobile numbers.</li></ol>
    ${colors}
    <h4>Good to know</h4><ul>
      <li>Only the classroom with the installed prototype shows live sensor readings. Other rooms are for future expansion.</li>
      <li>Monitoring needs an internet connection. SMS alerts need a cellular network.</li></ul>`;

  const features = admin ? `<ul>
      <li><b>Admin dashboard:</b> readings and status for each room, with the system status.</li>
      <li><b>Rooms:</b> add a room with the + button. The number follows the floor, such as 101, 201, 301 or 401. Remove rooms in Settings.</li>
      <li><b>Exhaust fan control:</b> turn the fan on or off in Monitoring, or leave it in Automatic mode. Choose whether it starts at yellow or red.</li>
      <li><b>Thresholds:</b> set the warning and limit for temperature, humidity and CO₂.</li>
      <li><b>SMS Alerts:</b> choose who receives texts, with name, role and mobile number. Switch people on or off, edit or remove them.</li>
      <li><b>Manage Users:</b> see admin and registered accounts, and add other admins.</li>
      <li><b>Account Settings:</b> change your own password.</li>
      <li><b>Device status:</b> check the controller, sensors, fan, Wi-Fi and SMS module.</li>
      <li><b>Alerts and history:</b> review warnings, danger alerts and charts for the last 6 hours, 24 hours or 7 days.</li></ul>`
  : `<ul>
      <li><b>Real-time readings:</b> temperature, humidity and CO₂ for the room you choose.</li>
      <li><b>Room status:</b> green, yellow and red indicators show the room's condition.</li>
      <li><b>Exhaust fan status:</b> see whether the exhaust fan is running, and whether it is in Automatic or Manual mode.</li>
      <li><b>Room selection:</b> pick a room by floor.</li>

      <li><b>History:</b> charts for the last 6 hours, 24 hours or 7 days.</li>
      <li><b>Alerts:</b> warnings, danger alerts and system messages, tagged by room.</li>
      <li><b>SMS alerts:</b> your registered mobile number gets a text at Warning or Danger.</li>
      <li><b>Dark mode:</b> switch it on or off from the menu.</li></ul>`;

  return `<div style="text-align:center;padding:6px 0 18px">${logo(88)}<div class="wordmark" style="font-size:26px">SafeZone</div><p class="sub">Safer and healthier indoor environments for everyone.</p>
      <span class="tag" style="margin:10px 0 0">${admin ? 'Admin guide' : 'Student / Faculty guide'}</span></div>
    <div class="list">
      ${d('info', 'System Overview', 'Learn how SafeZone works', overview, true)}
      ${d('sliders', 'Features', admin ? 'What you can do as an admin' : 'What you can do in the app', features)}
      ${d('mail', 'Contact', 'For inquiries or support', `Email us at <b>${esc(CONTACT.email)}</b>.`)}
    </div>`;
}

function shell() {
  const bodies = { home: homeView, alerts: alertsView, monitor: monitorView, status: statusView, settings: settingsView, about: aboutView, users: usersView, students: studentsView, rooms: overviewView, analytics: analyticsView };
  return `${topbar()}<main class="screen" id="screen" data-s="${S.screen}">${S.syncError ? `<p class="note" role="alert">Shared updates are unavailable. Displayed readings may be out of date. ${esc(S.syncError)}</p>` : ''}${bodies[S.screen]()}</main>${nav()}`;
}

function splashView() {
  const leaf = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21C3 9 10 2 22 2c0 12-7 19-17 19z"/></svg>`;
  return `<div class="splash">
    <span class="leafdeco" style="left:-70px;bottom:-60px;transform:rotate(-20deg)">${leaf}</span>
    <span class="leafdeco" style="right:-80px;bottom:90px;transform:rotate(200deg);opacity:.6">${leaf}</span>
    <button class="themebtn" data-act="theme" aria-label="${effectiveDark() ? 'Switch to light mode' : 'Switch to dark mode'}">${effectiveDark() ? I.sun : I.moon}</button>
    ${logo(120)}
    <div class="wordmark">SafeZone</div>
    <p class="tag-line">Safer and healthier indoor environments for everyone.</p>
    <button class="role-btn primary" data-act="role" data-v="student">${I.cap}<span>${esc(LABELS.viewer)}</span>${I.chev}</button>
    <button class="role-btn secondary" data-act="role" data-v="admin">${I.sliders}<span>${esc(LABELS.control)}</span>${I.chev}</button>
  </div>`;
}

/* ---------- shared pieces for the sign-up / login screens ---------- */
const authBack = to => `<button class="back" data-act="to" data-v="${to}">${I.back}Back</button>`;
const circle = ic => `<div class="circle">${I[ic]}</div>`;
const errLine = () => `<p class="err" id="err" role="alert">${esc(S.authError)}</p>`;
const noteLine = () => S.notice ? `<p class="okmsg" role="status">${esc(S.notice)}</p>` : '';
const pwField = (id, ph, auto) => `<div class="field">${I.lock}<input type="password" id="${id}" placeholder="${ph}" aria-label="${ph}" autocomplete="${auto}"><button type="button" class="eye" data-act="pw" data-v="${id}" aria-label="Show password">${I.eye}</button></div>`;
const textField = (ic, id, ph, type, extra) => `<div class="field">${I[ic]}<input type="${type}" id="${id}" placeholder="${ph}" aria-label="${ph}" ${extra || ''}></div>`;
const rulesList = (field = 'rp') => `<ul class="rules" id="${field==='rp'?'rules':'rules-'+field}" data-password-for="${field}" aria-label="Password rules">${pwRules('').map(([t, ok]) => `<li class="${ok ? 'ok' : ''}">${I.check}${t}</li>`).join('')}</ul>`;
const emailInput = (id, val) => `<div class="field">${I.mail}<input type="email" id="${id}" inputmode="email" placeholder="PUP web mail" aria-label="PUP web mail" autocapitalize="none" autocomplete="email" value="${esc(val || '')}"></div>`;
const phoneInput = () => `<div class="field">${I.phone}<input type="tel" id="phone" inputmode="numeric" placeholder="09XXXXXXXXX" aria-label="Mobile number" autocomplete="tel" value="${esc(S.reg.phone)}"></div>`;

/* ---------- Student side: access, register (phone), password, done, login ---------- */
function vWelcomeView() {
  return `<div class="splash auth">${authBack('splash')}<div class="auth-in">
    ${circle('cap')}
    <h2>${esc(LABELS.viewer)} Access</h2>
    <p class="tag-line" style="margin-bottom:18px">Create an account to view classroom environmental information.</p>
    <div class="feat">
      <div>${I.chart}<span>View real-time readings</span></div>
      <div>${I.info}<span>Check room status</span></div>
      <div>${I.bell}<span>Receive alerts and announcements</span></div>
    </div>
    <button class="btn" style="margin-top:20px" data-act="to" data-v="vReg1">Create Account</button>
    <button class="btn soft" style="margin-top:10px" data-act="to" data-v="vLogin">I already have an account</button>
    <button class="linkbtn" style="margin-top:14px;font-size:13px" data-act="to" data-v="splash">Back to Home</button>
  </div></div>`;
}

function vReg1View() {
  return `<div class="splash auth">${authBack('vWelcome')}<div class="auth-in">
    ${circle('mail')}
    <h2>Create Account</h2>
    <p class="tag-line" style="margin-bottom:20px">Register with your PUP web mail and mobile number.</p>
    <form id="v-reg1-form" style="width:100%" novalidate>
      <label class="flabel" for="email">PUP Web Mail</label>
      ${emailInput('email', S.reg.email || '')}
      <p class="hint">${emailHintHtml}</p>
      <label class="flabel" for="phone">Mobile Number</label>
      ${phoneInput()}
      <p class="hint">Enter a valid Philippine mobile number (e.g. 09XXXXXXXXX)</p>
      <div id="registration-profile" class="stack" ${emailKind(S.reg.email)==='faculty'?'hidden':''}>${profileFields('reg',S.reg)}</div>
      ${errLine()}
      <button class="btn" type="submit">Next</button>
    </form>
  </div></div>`;
}

function vReg2View() {
  return `<div class="splash auth">${authBack('vReg1')}<div class="auth-in">
    ${circle('lock')}
    <h2>Create Password</h2>
    <p class="tag-line" style="margin-bottom:18px">Set a password for your account.</p>
    <form id="v-reg2-form" style="width:100%" novalidate>
      <label class="flabel" for="rp">Password</label>
      ${pwField('rp', 'Password', 'new-password')}
      ${rulesList()}
      <label class="flabel" for="rc">Confirm Password</label>
      ${pwField('rc', 'Confirm password', 'new-password')}
      ${errLine()}
      <button class="btn" type="submit">Create Account</button>
    </form>
  </div></div>`;
}

function vDoneView() {
  return `<div class="splash auth"><div class="auth-in">
    <div class="circle ok">${I.check}</div>
    <h2>Account Created!</h2>
    <p class="tag-line" style="margin-bottom:24px">Welcome to SafeZone. You can now log in and view classroom information.</p>
    <button class="btn" data-act="to" data-v="vLogin">Go to Login</button>
  </div></div>`;
}

function vLoginView() {
  return `<div class="splash auth">${authBack('vWelcome')}<div class="auth-in">
    ${logo(96, true)}
    <h2>Log in</h2>
    <p class="tag-line" style="margin-bottom:20px">Use your mobile number and password.</p>
    ${noteLine()}
    <form id="v-login-form" style="width:100%" novalidate>
      <label class="flabel" for="phone">Mobile Number</label>
      ${phoneInput()}
      <label class="flabel" for="pw">Password</label>
      ${pwField('pw', 'Password', 'current-password')}
      ${errLine()}
      <button class="btn" type="submit">Log in</button>
    </form>
    <button class="linkbtn" style="margin-top:14px;font-size:13px" data-act="forgot" data-v="viewer">Forgot password?</button>
    <button class="linkbtn" style="margin-top:10px;font-size:13px" data-act="to" data-v="vReg1">Create an account</button>
  </div></div>`;
}

/* ---------- Admin side: login and register ---------- */
function loginView() {
  return `<div class="splash auth">${authBack('splash')}<div class="auth-in">
    ${logo(96)}
    <div class="wordmark" style="font-size:28px">SafeZone</div>
    <h2 style="margin-top:6px">Admin Login</h2>
    <p class="tag-line" style="margin-bottom:20px">Access the system to manage and control.</p>
    ${noteLine()}
    <form id="login-form" style="width:100%" autocomplete="off" novalidate>
      ${textField('user', 'u', 'Username', 'text', 'autocapitalize="none" autocomplete="username"')}
      ${pwField('pw', 'Password', 'current-password')}
      ${errLine()}
      <button class="btn" type="submit">Log in</button>
    </form>
    <button class="linkbtn" style="margin-top:14px;font-size:13px" data-act="forgot" data-v="admin">Forgot password?</button>
    <p class="note" style="margin-top:14px">Use an account created on your SafeZone server.</p>
  </div></div>`;
}

/* ---------- Forgot password: login identifier, code, new password ---------- */
function fpCodeView() {
  const r = S.reset;
  return `<div class="splash auth">${authBack(S.reset?.side==='admin'?'login':'vLogin')}<div class="auth-in">
    ${circle('key')}
    <h2>Enter Code</h2>
    <p class="tag-line" style="margin-bottom:16px;max-width:100%">If this account is registered, a verification code has been requested for its saved PUP webmail. It expires in ${RESET_MINUTES} minutes.<br>Open your Outlook Inbox or Junk folder and enter the code below.</p>
    <form id="fp-code-form" style="width:100%" novalidate>
      <label class="flabel" for="fpc">6-digit code</label>
      <div class="field">${I.key}<input type="text" id="fpc" inputmode="numeric" maxlength="6" placeholder="000000" aria-label="6-digit code" autocomplete="one-time-code"></div>
      ${errLine()}
      <button class="btn" type="submit">Verify code</button>
    </form>
    <button class="linkbtn" style="margin-top:14px;font-size:13px" data-act="fpResend">Send a new code</button>
  </div></div>`;
}

function fpNewView() {
  return `<div class="splash auth">${authBack(S.reset?.side==='admin'?'login':'vLogin')}<div class="auth-in">
    ${circle('lock')}
    <h2>New Password</h2>
    <p class="tag-line" style="margin-bottom:18px">Set a new password for your account.</p>
    <form id="fp-new-form" style="width:100%" novalidate>
      <label class="flabel" for="rp">New Password</label>
      ${pwField('rp', 'New password', 'new-password')}
      ${rulesList()}
      <label class="flabel" for="rc">Confirm Password</label>
      ${pwField('rc', 'Confirm password', 'new-password')}
      ${errLine()}
      <button class="btn" type="submit">Update password</button>
    </form>
  </div></div>`;
}

function fpDoneView() {
  return `<div class="splash auth"><div class="auth-in">
    <div class="circle ok">${I.check}</div>
    <h2>Password Updated</h2>
    <p class="tag-line" style="margin-bottom:24px">You can now log in with your new password.</p>
    <button class="btn" data-act="to" data-v="${S.resetSide === 'admin' ? 'login' : 'vLogin'}">Go to Login</button>
  </div></div>`;
}

const formDrafts = new Map();
let captureEnabled = true, settingsDirty = false, settingsDraft = null;
const formKey = form => form.dataset.draftKey || form.id;
function readDeviceRows() {
  return Array.from(document.querySelectorAll('.device-editor'), row => ({
    type:row.querySelector('[data-device="type"]').value,
    label:row.querySelector('[data-device="label"]').value,
    quantity:Number(row.querySelector('[data-device="quantity"]').value),
    activeQuantity:0,
    wattsPerDevice:Number(row.querySelector('[data-device="wattsPerDevice"]').value),
    fanType:row.querySelector('[data-device="fanType"]').value
  }));
}
function captureDrafts() {
  if (!captureEnabled) return;
  document.querySelectorAll('form[id]').forEach(form => {
    if(form.dataset.dirty!=='1' && !formDrafts.has(formKey(form)))return;
    const values=Array.from(form.querySelectorAll('input,select,textarea'),(el,index)=>({key:el.id || el.name || String(index),value:el.value,checked:el.checked}));
    formDrafts.set(formKey(form),{values,devices:form.id==='room-form'?readDeviceRows():undefined,floor:form.id==='room-form'?S.addFloor:undefined});
  });
  if (settingsDirty && $('#temp-warn')) settingsDraft={
    values:KEYS.flatMap(k=>['warn','limit'].map(part=>({id:k+'-'+part,value:$('#'+k+'-'+part).value}))),
    trigger:S.draftTrigger,auto:S.draftAuto
  };
}
function restoreDrafts() {
  document.querySelectorAll('form[id]').forEach(form => {
    const draft=formDrafts.get(formKey(form)); if(!draft)return;
    form.dataset.dirty='1';
    Array.from(form.querySelectorAll('input,select,textarea')).forEach((el,index)=>{
      const value=draft.values.find(v=>v.key===(el.id || el.name || String(index)));
      if(value){el.value=value.value;if(el.type==='checkbox')el.checked=value.checked;}
    });
  });
  document.querySelectorAll('[data-password-for]').forEach(ul=>{
    const input=document.getElementById(ul.dataset.passwordFor);if(!input)return;
    const checks=pwRules(input.value);
    ul.querySelectorAll('li').forEach((el,index)=>el.classList.toggle('ok',checks[index][1]));
  });
  if(settingsDraft && $('#temp-warn')){
    settingsDraft.values.forEach(v=>{$('#'+v.id).value=v.value;});
    S.draftTrigger=settingsDraft.trigger;S.draftAuto=settingsDraft.auto;
    document.querySelectorAll('[data-act="trigger"]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.v===S.draftTrigger)));
    $('#draft-auto').setAttribute('aria-checked',String(S.draftAuto));
  }
}

function render() {
  captureDrafts();
  const view = $('#view'); const prev = $('#screen');
  const top = prev && prev.dataset.s === S.screen ? prev.scrollTop : 0;
  const expanded=new Map(Array.from(document.querySelectorAll('#screen details[data-keep-open]'),d=>[d.dataset.keepOpen,d.open]));
  const AUTH = { splash: splashView, login: loginView, vWelcome: vWelcomeView, vLogin: vLoginView, vReg1: vReg1View, vReg2: vReg2View, vDone: vDoneView, fpCode: fpCodeView, fpNew: fpNewView, fpDone: fpDoneView };
  view.innerHTML = AUTH[S.screen] ? AUTH[S.screen]() : shell();
  document.querySelectorAll('#screen details[data-keep-open]').forEach(d=>{if(expanded.has(d.dataset.keepOpen))d.open=expanded.get(d.dataset.keepOpen);});
  restoreDrafts(); captureEnabled=true;
  const sc = $('#screen'); if (sc) sc.scrollTop = top;
}

/* =====================================================================
   SHEETS & TOAST
   ===================================================================== */
let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
function openSheet(title, html) {
  captureDrafts();
  const prev = $('#sheet-root .sheet'); const keep = prev && prev.getAttribute('aria-label') === title ? prev.querySelector('.sheet-content').scrollTop : 0;
  $('#sheet-root').innerHTML = `<div class="overlay" data-act="closeSheet" data-overlay="1"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-top"><div class="grab"></div>
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="x" data-act="closeSheet" aria-label="Close">${I.x}</button></div></div><div class="sheet-content">${html}</div></div></div>`;
  restoreDrafts();
  const sh = $('#sheet-root .sheet'); if (sh) { sh.setAttribute('tabindex', '-1'); sh.focus({ preventScroll: true }); sh.querySelector('.sheet-content').scrollTop = keep; }
}
const closeSheet = () => { captureDrafts(); $('#sheet-root').innerHTML = ''; };

function userCards(title, people, admin = false, removable = false) {
  const emailText = email => esc(email).replace(/@/g,'@<wbr>').replace(/\./g,'.<wbr>');
  return `<section class="account-group"><div class="account-group-heading"><h3>${esc(title)}</h3><span class="account-count">${people.length}</span></div><div class="account-card-list">${people.map(a=>`<article class="account-card">
    <div class="account-card-heading"><div class="account-card-identity"><strong>${admin?esc(a.name):emailText(a.email)}</strong>${admin?`<p>${esc(a.username || '')}</p>`:''}</div>${removable?`<button type="button" class="x student-delete" title="Delete student" data-act="studentRemove" data-v="${a.id}" aria-label="Delete student ${esc(a.email)}">${I.trash}</button>`:''}</div>
    <dl>${admin?`<div><dt>PUP webmail</dt><dd>${emailText(a.email)}</dd></div>`:''}<div><dt>Mobile</dt><dd>${esc(showPhone(a.phone))}</dd></div>${removable?`<div><dt>Account status</dt><dd>${a.active===false?'Inactive':'Active'}</dd></div>`:''}</dl>
  </article>`).join('') || '<p class="empty">No accounts in this group.</p>'}</div></section>`;
}
function studentsView() {
  if(S.role!=='admin')return '<p class="empty">Admin access is required.</p>';
  const students=S.accounts.filter(a=>a.role==='viewer' && a.kind==='student');
  const course=S.studentCourse,section=S.studentSection;
  const countLabel = count => `${count} student${count===1?'':'s'}`;
  const browseButton = (act,value,title,subtitle,count) => `<button class="student-browse-button" data-act="${act}" data-v="${esc(value)}"><span class="student-browse-label"><b>${esc(title)}</b>${subtitle?`<small>${esc(subtitle)}</small>`:''}</span><span class="account-count">${countLabel(count)}</span>${I.chev}</button>`;
  const context=`<div class="student-page-context"><nav class="student-breadcrumb" aria-label="Student account location"><button data-act="studentCourses" ${course===null?'aria-current="page"':''}>Courses</button>${course!==null?`${I.chev}<button data-act="studentCourse" data-v="${esc(course)}" ${section===null?'aria-current="page"':''}>${esc(course || 'Course not set')}</button>`:''}${section!==null?`${I.chev}<span aria-current="page">${esc(section || 'Section not set')}</span>`:''}</nav></div>`;
  if(course===null){
    const codes=[...new Set([...Object.keys(COURSES),...students.map(a=>a.courseCode||'')])];
    return `${context}<p class="note">${countLabel(students.length)} · Select a course to view its sections.</p><div class="student-browse-list">${codes.map(code=>browseButton('studentCourse',code,code||'Course not set',code?courseName(code):'Students without a saved course',students.filter(a=>(a.courseCode||'')===code).length)).join('')}</div>`;
  }
  const people=students.filter(a=>(a.courseCode||'')===course);
  if(section===null){
    const sections=[...new Set(people.map(a=>a.section||''))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    return `${context}<h2 class="student-stage-title">${esc(courseName(course))}</h2><p class="note">${countLabel(people.length)} · Select a section to view student profiles.</p><div class="student-browse-list">${sections.map(value=>browseButton('studentSection',value,value||'Section not set','',people.filter(a=>(a.section||'')===value).length)).join('') || '<p class="empty">No student accounts in this course yet.</p>'}</div>`;
  }
  const profiles=people.filter(a=>(a.section||'')===section).sort((a,b)=>a.email.localeCompare(b.email));
  return `${context}<p class="note">${esc(course || 'Course not set')} · ${esc(section || 'Section not set')}</p>${userCards('Student profiles',profiles,false,true)}`;
}

function usersView() {
  if (S.role !== 'admin') return '<p class="empty">Admin access is required.</p>';
  const admins = S.accounts.filter(a => a.role === 'admin');
  const students = S.accounts.filter(a => a.role === 'viewer' && a.kind === 'student');
  const faculty = S.accounts.filter(a => a.role === 'viewer' && a.kind === 'faculty');
  return `<p class="sub">Manage admin and faculty accounts, or open Student Accounts to browse by course and section.</p>
    <button class="card student-accounts-link" data-act="students">${I.users}<span><b>Student Accounts</b><small>${students.length} students · organized by course and section</small></span>${I.chev}</button>${userCards('Admins', admins, true)}${userCards('Faculty', faculty)}
    <p class="note">Who gets SMS alerts is set in Settings, under SMS Alerts.</p>
    <p class="section-label">Add another admin</p>
    <p class="note">Create an account for another administrator. They can change their password in Account Settings.</p>
    <form id="admin-form" class="stack" autocomplete="off" novalidate>
      ${textField('user', 'an', 'Full name', 'text', 'autocomplete="off" required minlength="2" maxlength="100"')}
      ${textField('user', 'au', 'Username', 'text', 'autocapitalize="none" autocomplete="off" required minlength="3" maxlength="20"')}
      ${textField('mail', 'aem', 'PUP web mail', 'email', 'inputmode="email" autocapitalize="none" autocomplete="off"')}
      ${textField('phone', 'ap', 'Mobile number (09XXXXXXXXX)', 'tel', 'inputmode="numeric" autocomplete="off"')}
      ${pwField('rp', 'Password for the new admin', 'new-password')}
      ${rulesList()}
      <p class="err" data-form-error role="alert"></p>
      <button class="btn small" type="submit">Add admin</button>
    </form>`;
}

// SMS Alerts: who gets a text. Each person has a name, a role and a mobile number.
function smsSheet(edit) {
  edit = edit == null ? -1 : edit;
  const u = edit >= 0 ? S.users[edit] : null;
  const roles = u && !ROLES.includes(u.role) ? ROLES.concat([u.role]) : ROLES;
  const rows = S.users.map((x, i) => {
    const armed = S.pendingDel === 'sms:' + i;
    return `<div class="user-row"><div><b>${esc(x.name)}</b><span>${esc(x.role)}, <span class="nw">${esc(x.phone)}</span></span></div>
      <button class="x" data-act="smsEdit" data-v="${i}" aria-label="Edit ${esc(x.name)}">${I.edit}</button>
      <button class="x del ${armed ? 'armed' : ''}" data-act="smsDel" data-v="${i}" aria-label="Remove ${esc(x.name)}">${armed ? 'Remove?' : I.trash}</button>
      <button class="switch" role="switch" aria-checked="${x.sms}" aria-label="SMS alerts for ${esc(x.name)}" data-act="userSms" data-v="${i}"><span></span></button></div>`;
  }).join('');
  openSheet('SMS Alerts', `<p class="note" style="margin:0 4px 10px">These people get a text when a reading reaches Warning or Danger. Switch someone off to stop their texts.</p>
    <div class="list">${rows || '<p class="empty">No recipients yet.</p>'}</div>
    <p class="section-label">${u ? 'Edit recipient' : 'Add recipient'}</p>
    <form id="sms-form" class="stack" data-edit="${edit}" autocomplete="off" novalidate>
      ${textField('user', 'sn', 'Name (who is this?)', 'text', 'autocomplete="off"')}
      <select id="sr" aria-label="Role"><option value="" disabled ${u ? '' : 'selected'}>Role</option>${roles.map(r => `<option value="${esc(r)}" ${u && u.role === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
      ${textField('phone', 'sp', 'Mobile number (09XXXXXXXXX)', 'tel', 'inputmode="numeric" autocomplete="off"')}
      <button class="btn small" type="submit">${u ? 'Save recipient' : 'Add recipient'}</button>
      ${u ? '<button type="button" class="btn soft small" data-act="smsCancel">Cancel</button>' : ''}
    </form>`);
  if (u) { $('#sn').value = u.name; $('#sp').value = u.phone; }
}

// Pick a room. Rooms are grouped by floor.
function pickSheet() {
  const now = cur().id;
  openSheet('Select Room', `<div class="floor-picker">${floorList().map(f => {
    const rooms = roomsOn(f);
    return `<details class="floor-section" name="room-floor" ${cur().floor===f?'open':''}>
      <summary><span>${floorName(f)}</span><small>${rooms.length} rooms</small>${I.chevd}</summary>
      <div class="floor-rooms">${rooms.length ? rooms.map(r => `<button class="room-opt" data-act="room" data-v="${r.id}" aria-pressed="${r.id === now}"><i class="rdot ${roomLevel(r)}"></i><span>${esc(r.name)}</span>${r.id === now ? I.check : ''}</button>`).join('') : '<p class="floor-empty">No classrooms on this floor.</p>'}</div></details>`;
  }).join('')}</div>`);
}

// Home and Monitoring add rooms; Settings configures existing rooms.
function defaultDevices() { return [
  {type:'exhaust_fan',label:'Exhaust fan',quantity:1,activeQuantity:0,wattsPerDevice:40,fanType:'unspecified'}
]; }
function deviceRows(devices) {
  return devices.map((d,i)=>`<section class="device-editor" ${!FEATURES.fanEnergy && d.type==='power_meter'?'hidden':''} data-index="${i}" aria-labelledby="device-title-${i}"><h3 class="device-editor-title" id="device-title-${i}">Device ${i+1}</h3><div class="device-editor-body">
    <label class="f">Device<select data-device="type" name="device-${i}-type">${Object.entries(DEVICE_NAMES).filter(([key])=>FEATURES.fanEnergy||key!=='power_meter'||d.type==='power_meter').map(([key,name])=>`<option value="${key}" ${key===d.type?'selected':''}>${name}</option>`).join('')}</select></label>
    <label class="f">Name<input type="text" data-device="label" name="device-${i}-label" value="${esc(d.label)}" maxlength="100"></label>
    <div class="fields3"><label class="f">Quantity<input data-device="quantity" name="device-${i}-quantity" type="number" min="1" max="100" value="${d.quantity}"></label>
    <label class="f" data-powered ${!FEATURES.fanEnergy||d.type!=='exhaust_fan'?'hidden':''}>Watts each<input data-device="wattsPerDevice" name="device-${i}-watts" type="number" min="0.1" max="2000" step="any" value="${d.wattsPerDevice}"></label>
    </div>
    <label class="f" data-fan ${d.type!=='exhaust_fan'?'hidden':''}>Exhaust fan type<select data-device="fanType" name="device-${i}-fan">${Object.entries(FAN_NAMES).map(([key,name])=>`<option value="${key}" ${key===(d.fanType||'unspecified')?'selected':''}>${name}</option>`).join('')}</select></label>
    <button type="button" class="linkbtn" data-act="removeDevice" data-v="${i}">Remove device</button></div></section>`).join('');
}
function roomsSheet() {
  const edit=S.rooms.find(r=>r.id===S.editingRoomId), key='room:'+(edit?edit.id:'new');
  const draft=formDrafts.get(key), devices=draft?.devices || (edit?(edit.devices || []).filter(d => d.type !== 'light'):defaultDevices());
  const floor=draft?.floor ?? (edit?edit.floor:S.addFloor||1);
  openSheet('Rooms',`<h2>${edit?'Edit '+esc(edit.name):'Add a room'}</h2>
    <form id="room-form" data-draft-key="${key}" data-room-id="${edit?edit.id:''}" class="stack" novalidate>
      <p class="flabel">Floor</p><div class="mini-chips" role="group" aria-label="Floor">${floorList().map(f=>`<button type="button" data-act="floor" data-v="${f}" aria-pressed="${f===floor}">${ord(f)}</button>`).join('')}</div>
      <label class="f">Room number<input type="number" id="rn" aria-label="Room number" value="${edit?roomNo(edit):nextRoomNumber(floor)||''}" min="${floor*100+1}" max="${floor*100+12}"></label>
      <p class="hint" id="rnhint">${floorHint(floor)}</p>
      <div class="room-device-heading"><p class="section-label">Devices</p><p class="note">Configure exhaust fans and the NodeMCU V3 ESP8266 with its sensors.</p></div>
      <div id="device-groups" class="stack">${deviceRows(devices||[])}</div>
      <button type="button" class="btn soft small" data-act="addDevice">+ Add device</button>
      <button type="submit" class="btn small">${edit?'Save room':'Add room'}</button>
    </form>`);
  S.addFloor=floor;
  updateRoomAvailability();
}

function accountSheet() {
  const me = S.me; if (!me) return;
  openSheet('Account Settings', `<div class="stack"><label class="f">Name<input type="text" value="${esc(me.name)}" disabled></label>
    <label class="f">Username<input type="text" value="${esc(me.username)}" disabled></label></div>
    <p class="section-label">PUP web mail</p>
    <form id="email-form" class="stack" novalidate>
      ${emailInput('ae', me.email || '')}
      <p class="note" style="margin:0">Your account, login, and password recovery email. Reset codes are sent directly to this PUP webmail.<br>${emailHintHtml}</p>
      <button class="btn small" type="submit">Save web mail</button>
    </form>
    <p class="note">Password reset codes are sent to this saved PUP webmail. Check Outlook Inbox and Junk; mark SafeZone messages as not junk if necessary.</p>
    ${me.role==='viewer' && me.kind==='student'?`<p class="section-label">Course and section</p><form id="student-profile-form" class="stack" novalidate>${profileFields('account',S.studentProfile || {})}<button class="btn small" type="submit">Save course and section</button></form>`:''}
    <p class="section-label">Change password</p>
    <form id="pw-form" class="stack" novalidate><input type="password" id="current-pw" placeholder="Current password" aria-label="Current password" autocomplete="current-password"><input type="password" id="np" placeholder="New password" aria-label="New password" autocomplete="new-password">${rulesList('np')}<input type="password" id="cp" placeholder="Confirm new password" aria-label="Confirm new password" autocomplete="new-password"><button class="btn small" type="submit">Update password</button></form>`);
}

/* =====================================================================
   ACTIONS
   ===================================================================== */
const ACTS = {
  role(v) {
    S.authError = ''; S.notice = ''; S.reg = { phone: '' };
    S.screen = v === 'student' ? 'vWelcome' : 'login'; render();
  },
  to(v) { S.authError = ''; S.notice = ''; S.screen = v; render(); },
  toMonitor() { S.mon.view = 'live'; S.screen = 'monitor'; render(); },
  menu() {
    const admin = S.role === 'admin'; const me = S.me; const dark = effectiveDark();
    const who = me ? esc(admin ? me.name : showPhone(me.phone)) : '';
    openSheet(admin ? 'Signed in as Admin' : 'Signed in', `<div class="stack"><p class="sub" style="margin:0 0 6px">${who ? `<b>${who}</b><br>` : ''}${admin ? 'You can change settings and control ventilation.' : 'You can view conditions and alerts. Only admins can change settings.'}</p>
      <div class="list"><div class="row"><span class="r-ico">${dark ? I.moon : I.sun}</span><div class="r-txt"><b>Dark mode</b><span>${dark ? 'On' : 'Off'}</span></div>
        <button class="switch" role="switch" aria-checked="${dark}" aria-label="Dark mode" data-act="theme"><span></span></button></div></div>
      <button class="btn soft" data-act="account">Account Settings</button>
      <button class="btn soft" data-act="logout">Log out</button></div>`);
  },
  metric(v) { S.mon.metric = v; render(); },
  view(v) { S.mon.view = v; render(); },
  range(v) { S.mon.range = v; render(); },
  filter(v) { S.alertFilter = v; render(); },
  pw(v, el) {
    const inp = $('#' + v); if (!inp) return;
    const show = inp.type === 'password'; inp.type = show ? 'text' : 'password';
    el.innerHTML = show ? I.eyeoff : I.eye; el.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  },
  async forgot(v,el) {
    if(el?.disabled)return;
    const side=v==='admin'?'admin':'viewer',input=$(side==='admin'?'#u':'#phone');
    const identifier=input?.value.trim()||'';
    if(!identifier){S.authError=side==='admin'?'Enter your username first, then select Forgot password.':'Enter your mobile number first, then select Forgot password.';if($('#err'))$('#err').textContent=S.authError;input?.focus();return;}
    const origin=S.screen,label=el?.textContent;
    if(el){el.disabled=true;el.textContent='Requesting code…';}
    try {
      await api('/auth/forgot','POST',{identifier});
      if(S.screen!==origin)return;
      S.reset={side,identifier,sentAt:Date.now()};S.authError='';S.notice='';S.screen='fpCode';render();
    }catch(error){if(S.screen===origin){S.authError=error.message;if($('#err'))$('#err').textContent=error.message;}}
    finally{if(el?.isConnected){el.disabled=false;el.textContent=label;}}
  },
  closeSheet(v, el, e) { if (el.dataset.overlay && e.target !== el) return; closeSheet(); },
  async account() { const result=await api('/auth/me/student-profile');S.studentProfile=result.profile;accountSheet(); },
  smsEdit(v) { S.pendingDel = ''; smsSheet(+v); },
  smsCancel() { S.pendingDel = ''; smsSheet(); },
  pickRoom() { pickSheet(); },
  async room(v) { if (S.rooms.some(r => r.id === v)) { S.roomId=v;S.alerts=[];S.unread=0;store.save();closeSheet();render();const selected=v,session=token;const result=await api(alertUrl(v));if(S.roomId===selected && token===session && S.role){S.alerts=result.alerts;S.archiveAvailable=result.archiveAvailable===true;render();} } },
  addRoom(v) { if(S.role!=='admin'||S.screen!=='monitor')return; S.editingRoomId=null; S.addFloor=v?+v:cur().floor; roomsSheet(); },
  editRoom(v) { if(S.role!=='admin'||S.screen!=='settings')return; captureDrafts(); S.editingRoomId=v; S.addFloor=S.rooms.find(r=>r.id===v).floor; roomsSheet(); },
  addDevice() { $('#room-form').dataset.dirty='1'; const devices=readDeviceRows();devices.push({type:'exhaust_fan',label:'Exhaust fan',quantity:1,activeQuantity:0,wattsPerDevice:40,fanType:'unspecified'});$('#device-groups').innerHTML=deviceRows(devices); },
  removeDevice(v) { $('#room-form').dataset.dirty='1'; const devices=readDeviceRows();devices.splice(Number(v),1);$('#device-groups').innerHTML=deviceRows(devices); },
  floor(v) {
    if($('#room-form'))$('#room-form').dataset.dirty='1';
    S.addFloor = +v;
    document.querySelectorAll('[data-act="floor"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    const rn = $('#rn'); if (rn) { const edit = S.rooms.find(r => r.id === $('#room-form').dataset.roomId); rn.value = edit && edit.floor === S.addFloor ? roomNo(edit) : nextRoomNumber(S.addFloor) || ''; rn.min = S.addFloor * 100 + 1; rn.max = S.addFloor * 100 + 12; }
    updateRoomAvailability();
  },
  theme() {
    S.theme = effectiveDark() ? 'light' : 'dark'; applyTheme(); store.save();
    if ($('#sheet-root .sheet')) ACTS.menu(); else render();
  },
  trigger(v) { settingsDirty=true; S.draftTrigger = v; document.querySelectorAll('[data-act="trigger"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); },
  draftAuto(v, el) { settingsDirty=true; S.draftAuto = !S.draftAuto; el.setAttribute('aria-checked', S.draftAuto); },
  async sim(v) {
    const selected = S.simScope === 'all' ? { allRooms: true } : {
      roomIds: S.simScope === 'selected' ? S.simSelected.map(Number) : [Number(S.simScope.startsWith('room:') ? S.simScope.slice(5) : S.roomId)]
    };
    const result = await api('/simulation', 'POST', { metric: v, ...selected });
    await refreshData(); render();
    toast(v === 'reset' ? `Shared readings reset for ${result.affectedRoomIds.length} room(s).` :
      `Shared simulation started for ${result.affectedRoomIds.length} room(s). Readings will rise gradually.`);
  }
};

Object.assign(ACTS, {
  async go(v) {
    if(v!=='alerts')S.alertView='active';
    if (['settings', 'alerts', 'home'].includes(v)) await refreshData();
    S.screen = v; if (v === 'alerts') S.unread = 0;
    if (v === 'settings') { S.draftAuto = S.rooms.every(r => r.vent.mode === 'auto'); S.draftTrigger = S.fanTrigger; }
    render();
    if(v==='analytics')await loadTemperatureAnalytics();
  },
  async analyticsRange(v) {if(!['7d','30d','all'].includes(v))return;S.temperatureAnalytics.range=v;S.temperatureAnalytics.data=null;await loadTemperatureAnalytics();},
  async analyticsRetry() {await loadTemperatureAnalytics();},
  logout() { signOut(); render(); },
  async alertView(v) {
    if(!['active','archived'].includes(v))return;
    S.alertView=v;S.unread=0;S.alerts=[];render();
    const session=token,room=S.roomId,result=await api(alertUrl());
    if(token===session&&S.roomId===room&&S.alertView===v){S.alerts=result.alerts;S.archiveAvailable=result.archiveAvailable===true;render();}
  },
  async archiveAlert(v,el) {
    if(el.disabled||!S.archiveAvailable)return;
    el.disabled=true;
    try {await api('/alerts/archive','PUT',{ids:v.split(',').map(Number),archived:el.dataset.restore!=='true'});await refreshData();render();toast(el.dataset.restore==='true'?'Alert restored':'Alert archived');}
    finally{if(el.isConnected)el.disabled=false;}
  },
  async monitorRoom(v) {
    if(!S.rooms.some(r=>r.id===v))return;
    S.alertView='active';S.roomId=v;S.unread=0;S.alerts=[];S.mon.view='live';S.screen='monitor';store.save();render();
  },
  async users() {
    if (S.role !== 'admin') return;
    await refreshData(); closeSheet(); S.screen = 'users'; render();
  },
  async students() {if(S.role!=='admin')return;await refreshData();closeSheet();S.studentCourse=null;S.studentSection=null;S.screen='students';render();},
  studentCourses() {if(S.role!=='admin')return;S.studentCourse=null;S.studentSection=null;render();},
  studentCourse(v) {if(S.role!=='admin')return;S.studentCourse=v;S.studentSection=null;render();const screen=$('#screen');if(screen)screen.scrollTop=0;},
  studentSection(v) {if(S.role!=='admin'||S.studentCourse===null)return;S.studentSection=v;render();const screen=$('#screen');if(screen)screen.scrollTop=0;},
  studentsBack() {if(S.role!=='admin')return;if(S.studentSection!==null)S.studentSection=null;else S.studentCourse=null;render();},
  studentRemove(v) {
    if(S.role!=='admin')return;
    const student=S.accounts.find(a=>String(a.id)===v && a.role==='viewer' && a.kind==='student');
    if(!student)return;
    openSheet('Delete student permanently?',`<p>Permanently delete the account for <b>${esc(student.email)}</b>?</p><p class="note">This cannot be undone. The account, student profile, reset codes and linked SMS contact will be deleted. Existing sessions will stop working. The email and phone number can be registered again.</p><div class="stack"><button class="btn" data-act="confirmStudentRemove" data-v="${student.id}">Delete permanently</button><button class="btn soft" data-act="closeSheet">Cancel</button></div>`);
  },
  async confirmStudentRemove(v,el) {
    if(S.role!=='admin'||el.disabled)return;
    el.disabled=true;
    try {
      await api('/admin/users/'+v,'DELETE');
      await refreshData();closeSheet();S.screen='students';render();toast('Student account deleted');
    } finally {if(el.isConnected)el.disabled=false;}
  },
  async sms() { await refreshData(); S.pendingDel = ''; smsSheet(); },
  async smsDel(v) {
    const key = 'sms:' + v;
    if (S.pendingDel !== key) { S.pendingDel = key; smsSheet(); return; }
    await api('/sms-recipients/' + S.users[+v].id, 'DELETE');
    await refreshData(); S.pendingDel = ''; smsSheet(); toast('Recipient removed');
  },
  async userSms(v) {
    const u = S.users[+v]; await api('/sms-recipients/' + u.id, 'PATCH', { smsEnabled: !u.sms });
    await refreshData(); smsSheet();
  },
  async roomDel(v) {
    if(S.role!=='admin'||S.screen!=='settings')return;
    const room=S.rooms.find(r=>r.id===v);if(!room)return;
    captureDrafts();
    openSheet('Remove '+room.name+'?',`<p>This will remove ${esc(room.name)} and its configured devices. Alert history will remain without a room link.</p><div class="stack"><button class="btn" data-act="confirmRoomDel" data-v="${v}">Remove ${esc(room.name)}</button><button class="btn soft" data-act="cancelRoomDel">Cancel</button></div>`);
  },
  async confirmRoomDel(v) {
    await api('/rooms/'+encodeURIComponent(v),'DELETE');formDrafts.delete('room:'+v);
    if(S.editingRoomId===v)S.editingRoomId=null;await refreshData();closeSheet();S.screen='settings';render();toast('Room removed');
  },
  cancelRoomDel() {closeSheet();S.screen='settings';render();},
  async save() {
    const thresholds = {};
    for (const k of KEYS) {
      const warn = Number($(`#${k}-warn`).value), limit = Number($(`#${k}-limit`).value);
      if (!Number.isFinite(warn) || !Number.isFinite(limit) || warn >= limit) throw new Error('Enter valid limits: warning must be lower than limit.');
      thresholds[k] = { warn, limit };
    }
    await api('/settings', 'PUT', { thresholds, fanTrigger: S.draftTrigger, ventMode: S.draftAuto ? 'auto' : 'manual' });
    settingsDirty=false;settingsDraft=null;
    await refreshData(); render(); toast('Changes saved to the server');
  },
  async toggleVent() {
    await api('/simulation', 'POST', { metric: 'fan', roomIds: [Number(S.roomId)], fanOn: !S.vent.on });
    await refreshData(); render(); toast('Shared demo fan updated; hardware is not connected');
  },
  async auto() {
    await api('/rooms/' + cur().id, 'PATCH', { ventMode: 'auto' });
    await refreshData(); render(); toast('Automatic mode saved; hardware is not connected');
  },
  async fpResend() {
    if (!S.reset) return;
    await api('/auth/forgot', 'POST', { identifier: S.reset.identifier });
    S.reset.sentAt = Date.now(); S.authError = ''; render(); toast('If registered, a new code was requested');
  }
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = ACTS[el.dataset.act]; if (fn) Promise.resolve().then(() => fn(el.dataset.v, el, e)).catch(err => toast(err.message));
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, id = form.id;
  const button = form.querySelector('button[type="submit"]');
  if (button && button.disabled) return;
  if (button) button.disabled = true;
  const value = id => $('#' + id).value;
  const passwords = () => {
    const password = value('rp');
    if (!pwRules(password).every(r => r[1])) throw new Error('Password must meet all the listed rules.');
    if ($('#rc') && password !== value('rc')) throw new Error('The two passwords do not match.');
    return password;
  };
  try {
    if (id === 'login-form' || id === 'v-login-form') {
      await signedIn(await api('/auth/login', 'POST', {
        identifier: value(id === 'login-form' ? 'u' : 'phone').trim(), password: value('pw'), as: id === 'login-form' ? 'admin' : 'viewer'
      }));
    } else if (id === 'v-reg1-form') {
      const email = normEmail(value('email')), phone = normPhone(value('phone'));
      if (!emailKind(email)) throw new Error('Use your PUP web mail. ' + emailHint);
      if (!validPhone(phone)) throw new Error('Enter a valid Philippine mobile number.');
      S.reg = { email, phone, ...(emailKind(email)==='student'?readProfile('reg'):{}) }; S.authError = ''; S.screen = 'vReg2'; render();
    } else if (id === 'v-reg2-form') {
      await api('/auth/register', 'POST', { ...S.reg, password: passwords() });
      S.authError = ''; S.screen = 'vDone'; render();
    } else if (id === 'fp-code-form') {
      const result = await api('/auth/verify-code', 'POST', { identifier: S.reset.identifier, code: value('fpc').trim() });
      S.reset.resetToken = result.resetToken; S.authError = ''; S.screen = 'fpNew'; render();
    } else if (id === 'fp-new-form') {
      await api('/auth/reset', 'POST', { resetToken: S.reset.resetToken, newPassword: passwords() });
      S.resetSide = S.reset.side; S.reset = null; S.authError = ''; S.screen = 'fpDone'; render();
    } else if (id === 'admin-form') {
      const name=value('an').trim(),username=value('au').trim();
      if(name.length<2||name.length>100)throw new Error('Enter a full name from 2 to 100 characters.');
      if(!/^[a-z0-9._-]{3,20}$/i.test(username))throw new Error('Username must contain 3–20 letters, numbers, dots, dashes or underscores.');
      if(!emailKind(value('aem')))throw new Error('Enter a valid PUP webmail.');
      if(!validPhone(value('ap')))throw new Error('Enter a valid Philippine mobile number.');
      await api('/admin/users', 'POST', { fullName: value('an'), username: value('au'), email: value('aem'), phone: value('ap'), password: passwords() });
      await refreshData(); S.screen = 'users'; render(); toast('Admin account created');
    } else if (id === 'sms-form') {
      const edit = Number(form.dataset.edit), person = S.users[edit];
      await api('/sms-recipients' + (person ? '/' + person.id : ''), person ? 'PATCH' : 'POST', { name: value('sn'), role: value('sr'), phone: value('sp') });
      await refreshData(); S.pendingDel = ''; smsSheet(); toast('Recipient saved');
    } else if (id === 'room-form') {
      const roomId=form.dataset.roomId;
      const no=Number(value('rn'));
      if (!Number.isInteger(no) || no < S.addFloor*100+1 || no > S.addFloor*100+12 || EXCLUDED_ROOMS.includes(no)) throw new Error('Choose a valid classroom. ' + floorHint(S.addFloor));
      if (S.rooms.some(r => r.id !== roomId && roomNo(r) === no)) throw new Error('That classroom is already added.');
      const result=await api('/rooms'+(roomId?'/'+roomId:''),roomId?'PATCH':'POST',{
        floor:S.addFloor,roomNo:Number(value('rn')),devices:readDeviceRows()
      });
      formDrafts.delete(formKey(form));
      await refreshData(); if(!roomId)S.roomId=String(result.room.id); else S.configRoomId=String(result.room.id); captureEnabled=false; closeSheet(); render();
      toast(roomId?'Room updated':'Room added');
    } else if (id === 'student-profile-form') {
      const result=await api('/auth/me/student-profile','PUT',readProfile('account'));S.studentProfile=result.profile;toast('Course and section saved');
    } else if (id === 'email-form') {
      const data = await api('/auth/me/email', 'PUT', { email: value('ae') });
      S.me = mapUser(data.user); toast('Web mail saved');
    } else if (id === 'pw-form') {
      if (!pwRules(value('np')).every(rule=>rule[1])) throw new Error('New password must meet all the listed rules.');
      if (value('np') !== value('cp')) throw new Error('The two passwords do not match.');
      const data = await api('/auth/change-password', 'POST', { currentPassword: value('current-pw'), newPassword: value('np') });
      token = data.token; sessionStorage.setItem('safezone.token', token); closeSheet(); toast('Password updated');
    }
    formDrafts.delete(formKey(form));
    const freshForm=document.getElementById(id);if(freshForm && id==='admin-form')freshForm.reset();
  } catch (err) {
    S.authError = err.message; const error = form.querySelector('[data-form-error]') || $('#err');
    if (error) error.textContent = err.message; else toast(err.message);
  } finally { if (button && button.isConnected) button.disabled = false; }
});

// Live tick marks on the password rules while typing.
document.addEventListener('input', e => {
  if(e.target.form)e.target.form.dataset.dirty='1';
  if(/^(temp|hum|co2)-(warn|limit)$/.test(e.target.id))settingsDirty=true;
  if(e.target.id==='email' && $('#registration-profile'))$('#registration-profile').hidden=emailKind(e.target.value)==='faculty';
  if (!['rp','np'].includes(e.target.id)) return;
  const ul = document.querySelector('[data-password-for="'+e.target.id+'"]'); if (!ul) return;
  const res = pwRules(e.target.value);
  ul.querySelectorAll('li').forEach((li, i) => li.classList.toggle('ok', res[i][1]));
});

document.addEventListener('change', e => {
  if(e.target.form)e.target.form.dataset.dirty='1';
  if(e.target.matches('[data-device="type"]')){
    const row=e.target.closest('.device-editor'), type=e.target.value;
    row.querySelector('[data-fan]').hidden=type!=='exhaust_fan';
    row.querySelector('[data-powered]').hidden=!FEATURES.fanEnergy||type!=='exhaust_fan';
    row.querySelector('[data-device="label"]').value=DEVICE_NAMES[type];
    if(type==='exhaust_fan')row.querySelector('[data-device="wattsPerDevice"]').value=40;
  }
  if(e.target.id==='overview-floor'){S.overviewFloor=e.target.value;render();}
  if (e.target.id === 'config-floor') {
    const room=roomsOn(Number(e.target.value))[0];
    if(room){S.configRoomId=room.id;$('.room-configuration').outerHTML=roomConfiguration();}
  }
  if (e.target.id === 'config-room') {
    S.configRoomId = e.target.value;
    $('#config-room-edit').dataset.v = S.configRoomId;
    $('#config-room-delete').dataset.v = S.configRoomId;
  }
  if (e.target.id === 'sim-scope') {
    S.simScope = e.target.value;
    $('#sim-room-options').hidden = S.simScope !== 'selected';
    $('#sim-room-options').open = S.simScope === 'selected';
  }
  if (e.target.matches('.sim-room')) {
    S.simSelected = Array.from(document.querySelectorAll('.sim-room:checked'), el => el.value);
    $('#sim-room-count').textContent = '('+S.simSelected.length+' selected)';
  }
});

document.addEventListener('toggle',e=>{
  if(e.target.matches('.floor-section') && e.target.open)document.querySelectorAll('.floor-section').forEach(section=>{if(section!==e.target)section.open=false;});
},true);

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* =====================================================================
   INIT
   ===================================================================== */
(async function init() {
  const saved = store.load();
  if (saved && ['light', 'dark'].includes(saved.theme)) S.theme = saved.theme;
  S.rooms = DEFAULT_ROOMS.map(makeRoom); S.roomId = saved && saved.roomId || S.rooms[0].id;
  S.accounts = []; S.users = []; S.alerts = [];
  applyTheme(); render();
  if (token) {
    try {
      const data = await api('/auth/me');
      await signedIn({ token, user: data.user });
    } catch (err) {
      // A network outage keeps the token for retry; an invalid token is cleared by api().
      S.screen = 'splash'; render(); toast(err.message);
    }
  }
  setInterval(pollShared, 2000);
})();
})();
