(() => {
'use strict';

/* =====================================================================
   CONFIG: edit these first
   ===================================================================== */
// Put your logo here. In your own project use a normal path ('assets/logo.png').
// In a published page it must be a data: URI. Leave '' to show an empty slot.
const LOGO_SRC = 'images/logo.png';

// Button names on the start screen. Change the wording here.
const LABELS = { viewer: 'Student / Faculty', control: 'Admin' };

// Prototype accounts. They are saved on this phone/browser only.
// With the backend, registration and login become API calls and the server hashes passwords.
const ADMIN_CODE = 'SAFEZONE-ADMIN';   // needed to register an admin account from the login page. Change it.
const DEFAULT_ADMIN = { username: 'admin', password: 'safezone', name: 'Administrator', phone: '09170000001' };

// PUP web mail (Outlook). Students use @iskolarngbayan.pup.edu.ph, faculty use @pup.edu.ph.
// It is used to verify a person when they forget their password.
const WEBMAIL = { student: 'iskolarngbayan.pup.edu.ph', faculty: 'pup.edu.ph' };
const RESET_MINUTES = 10;        // how long a reset code works
const RESET_TRIES = 5;           // wrong guesses allowed per code
const RESEND_SECONDS = 30;       // wait before asking for another code
// The prototype cannot send email, so it shows the code on screen. Set to false when the backend sends real email.
const SHOW_DEMO_CODE = true;

// REAL EMAIL (optional). The app cannot send mail by itself, so it hands the message to an email service (EmailJS).
// Create a free EmailJS account, connect a mailbox, make a template, then fill in these three values.
// Leave them empty to stay in demo mode (the code is shown on screen instead of emailed).
const EMAIL_SEND = { serviceId: '', templateId: '', publicKey: '' };
const EMAIL_ON = !!(EMAIL_SEND.serviceId && EMAIL_SEND.templateId && EMAIL_SEND.publicKey);

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
// 1st floor starts with rooms 101 to 110. Floors 2, 3 and 4 start empty.
// Rooms are numbered by floor: 1st = 101, 102...  2nd = 201, 202...  3rd = 301...  4th = 401...
const DEFAULT_ROOMS = Array.from({ length: 10 }, (_, i) => ({ name: 'Room ' + (101 + i), floor: 1 }));
const ROOMS_V = 2;                                  // bump when the default rooms change (runs a one-time update)

// A new room starts with these numbers. Admins can change them when adding a room.
// (Used for the power display. With a real power meter the total comes from the meter.)
const ROOM_DEFAULTS = { lights: 8, lightWatts: 18, fanWatts: 40 };

// Choices in the SMS Alerts "role" list.
const ROLES = ['Admin', 'Faculty', 'Student', 'Student / Faculty', 'Maintenance', 'Other'];

/* =====================================================================
   DATA LAYER
   Everything below "simulator" is fake data. To connect real hardware,
   replace tick() with a fetch() to your backend (Blynk / MySQL API) that
   returns { temp, hum, co2, fanOn } for a room, then call ingest(reading, roomId).
   ===================================================================== */
const BASE = { temp: 27.4, hum: 58, co2: 827 };
const COOLED = { temp: 26, hum: 54, co2: 600 };      // where readings settle while the fan runs
const SCENARIOS = { co2: { co2: 1380 }, temp: { temp: 34.5 }, hum: { hum: 84 } };
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
  screen: 'splash',           // splash | vWelcome | vReg1 | vReg2 | vDone | vLogin | login | fReg | home | alerts | monitor | status | settings | about
  mon: { view: 'live', metric: 'temp', range: '6h' },
  alertFilter: 'all',
  rooms: [],                  // every room has its own readings, levels and fan. Built in init().
  roomId: null,               // the room being viewed
  fanTrigger: 'exceeded',     // when automatic ventilation turns ON: 'warning' (yellow) | 'exceeded' (red)
  draftTrigger: 'exceeded',
  limits: JSON.parse(JSON.stringify(DEFAULT_LIMITS)),
  alerts: [],
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
  load() { try { return JSON.parse(localStorage.getItem('safezone.v1') || 'null'); } catch (e) { return null; } },
  save() {
    try {
      localStorage.setItem('safezone.v1', JSON.stringify({
        limits: S.limits, users: S.users, accounts: S.accounts, session: S.session,
        fanTrigger: S.fanTrigger, roomId: S.roomId, theme: S.theme, roomsV: ROOMS_V,
        rooms: S.rooms.map(r => ({ id: r.id, name: r.name, floor: r.floor, lights: r.lights, lightWatts: r.lightWatts, fanWatts: r.fanWatts, mode: r.vent.mode }))
      }));
    } catch (e) { /* storage unavailable */ }
  }
};

/* =====================================================================
   HELPERS
   ===================================================================== */
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
const wattsText = w => Math.round(w).toLocaleString('en-US') + ' W';
const ord = n => { const v = n % 100; return n + ((v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'); };
const floorName = f => ord(f) + ' Floor';
const floorList = () => Array.from({ length: Math.max(FLOORS, ...S.rooms.map(r => r.floor || 1)) }, (_, i) => i + 1);
// "Room 301" -> 3rd floor. Used for rooms saved before floors existed.
const guessFloor = name => { const m = String(name).match(/(\d)\d\d/); const f = m ? +m[1] : 1; return f >= 1 && f <= FLOORS ? f : 1; };
const roomNo = r => { const m = String(r.name).match(/\d+/); return m ? parseInt(m[0], 10) : 0; };
const roomsOn = f => S.rooms.filter(r => r.floor === f).sort((a, b) => roomNo(a) - roomNo(b) || a.name.localeCompare(b.name));
// Next free number on a floor: 1st -> 101, 102...  2nd -> 201, 202...
const nextRoomNumber = f => { for (let n = f * 100 + 1; n <= f * 100 + 99; n++) if (!S.rooms.some(r => r.name.toLowerCase() === 'room ' + n)) return n; return null; };
const floorHint = f => `${ord(f)} floor rooms are ${f}01, ${f}02, ${f}03 and so on, up to ${f}99.`;
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
const emailTaken = (e, except) => S.accounts.some(a => a !== except && a.email && a.email === normEmail(e));
const maskEmail = e => { const [u, d] = normEmail(e).split('@'); return (u.length > 2 ? u.slice(0, 2) + '*'.repeat(Math.min(u.length - 2, 6)) : u[0] + '*') + '@' + d; };
// Real system: the server makes the code with a secure random generator and stores only a hash of it.
const newCode = () => {
  const a = (window.crypto && crypto.getRandomValues) ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296);
  return String(100000 + a % 900000);
};
// Prototype only. The backend will hash passwords on the server (bcrypt).
async function hashPw(id, pw) {
  const data = new TextEncoder().encode('safezone:' + id + ':' + pw);
  if (window.crypto && crypto.subtle) {
    const b = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(b)).map(n => n.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; data.forEach(c => { h = ((h << 5) + h + c) >>> 0; });
  return 'x' + h.toString(16);
}

/* ---------- icons ---------- */
const P = {
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

const logo = px => LOGO_SRC
  ? `<img class="logo" src="${LOGO_SRC}" alt="SafeZone logo" style="width:${px}px;height:${px}px">`
  : `<span class="logo logo-empty" role="img" aria-label="Logo placeholder" style="width:${px}px;height:${px}px"></span>`;

/* =====================================================================
   ALERTS & VENTILATION LOGIC
   ===================================================================== */
function pushAlert(a, quiet) {
  const room = cur() ? cur().name : '';
  S.alerts.unshift({ id: Date.now() + Math.random(), ts: Date.now(), cats: ['system'], sms: false, room, ...a });
  if (S.alerts.length > 80) S.alerts.pop();
  if (!quiet && S.role) {
    if (S.screen !== 'alerts') S.unread++;
    if (a.type === 'exceeded' || a.type === 'warning') toast(room ? `${room}: ${a.title}` : a.title);
  }
}

function seedAlerts() {
  const now = Date.now(); const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(16, 20, 0, 0);
  const room = S.rooms[0].name;
  S.alerts = [
    { id: 1, ts: now - 12 * 60e3, type: 'normal', cats: ['system'], title: 'System Normal', body: 'All readings are within the set limits.' },
    { id: 2, ts: now - 83 * 60e3, type: 'ventilation', cats: ['system'], title: 'Ventilation Activated', body: 'Automated ventilation is now ON.' },
    { id: 3, ts: now - 84 * 60e3, type: 'exceeded', cats: ['exceeded', 'message'], sms: true, title: 'High CO₂ Level', body: 'CO₂ level reached 1,200 ppm.' },
    { id: 4, ts: y.getTime(), type: 'normal', cats: ['system'], title: 'System Normal', body: 'All readings are within the set limits.' }
  ].map(a => ({ room, ...a }));
}

const smsLine = () => {
  const n = S.users.filter(u => u.sms).length;
  return { n, text: n ? `SMS sent to ${n} recipient${n === 1 ? '' : 's'}.` : 'No SMS recipients are switched on.' };
};

// Runs after every new reading or settings change, for the room being processed.
// Green = normal, yellow = warning, red = danger. Ventilation starts at the level set in Settings (red by default).
function evaluate() {
  KEYS.forEach(k => {
    const next = levelOf(k, S.reading[k]); const prev = S.levels[k]; const m = METRICS[k];
    if (RANK[next] > RANK[prev]) {
      const sms = smsLine();
      if (next === 'warning') {
        pushAlert({ type: 'warning', cats: ['message'], sms: sms.n > 0, title: `${m.label} Near Limit`, body: `${m.label} is at ${withUnit(k, S.reading[k])}. ${sms.text}` });
      } else {
        pushAlert({ type: 'exceeded', cats: ['exceeded', 'message'], sms: sms.n > 0, title: `High ${m.label} Level`, body: `${m.label} reached ${withUnit(k, S.reading[k])}. Limit is ${withUnit(k, S.limits[k].limit)}. ${sms.text}` });
      }
    }
    S.levels[k] = next;
  });
  const w = worst(); const need = S.fanTrigger === 'warning' ? 1 : 2;
  if (S.vent.mode === 'auto') {
    if (w >= need && !S.vent.on) {
      S.vent.on = true;
      pushAlert({ type: 'ventilation', cats: ['system'], title: 'Ventilation Activated', body: 'Automated ventilation is now ON.' });
    } else if (w === 0 && S.vent.on) {
      S.vent.on = false; S.scenario = null;
      pushAlert({ type: 'ventilation', cats: ['system'], title: 'Ventilation Stopped', body: 'Readings are back to normal. Automated ventilation is now OFF.' });
    }
  }
  if (w === 0 && S.prevWorst > 0) {
    pushAlert({ type: 'normal', cats: ['system'], title: 'System Normal', body: 'All readings are within the set limits.' });
  }
  S.prevWorst = w;
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
    vent: { mode: cfg.mode === 'manual' ? 'manual' : 'auto', on: false }, scenario: null,
    levels: { temp: 'normal', hum: 'normal', co2: 'normal' }, prevWorst: 0,
    buf: { t: [], temp: [], hum: [], co2: [] }
  };
  r.lightsOn = Math.round(r.lights * 0.75);
  r.reading = roomBase(r);
  const now = Date.now();
  for (let i = 29; i >= 0; i--) {
    r.buf.t.push(now - i * 2000);
    KEYS.forEach(k => r.buf[k].push(r.reading[k] + (rnd() - 0.5) * ({ temp: 0.3, hum: 1.2, co2: 24 })[k]));
  }
  return r;
}

// Watts in use. With a real power meter, "total" comes from the meter.
function power(r) {
  const lights = r.lightsOn * r.lightWatts, fan = r.vent.on ? r.fanWatts : 0, other = r.other;
  return { lights, fan, other, total: lights + fan + other };
}

function tick() {
  eachRoom(r => {
    const target = r.vent.on ? { ...COOLED } : { ...roomBase(r), ...(SCENARIOS[r.scenario] || {}) };
    const noise = { temp: 0.12, hum: 0.5, co2: 10 };
    KEYS.forEach(k => { r.reading[k] += (target[k] - r.reading[k]) * 0.18 + (Math.random() - 0.5) * noise[k]; });
    if (Math.random() < 0.02) r.lightsOn = Math.max(0, Math.min(r.lights, r.lightsOn + (Math.random() < 0.5 ? -1 : 1)));
    r.other = Math.max(30, Math.min(160, r.other + (Math.random() - 0.5) * 3));
    ingest(r.reading, null, true);
  });
  if (LIVE.has(S.screen) && S.role) render();
}

// Call this with real data: ingest({ temp, hum, co2 }, roomId)
function ingest(r, roomId, quiet) {
  const keep = S.roomId; if (roomId) S.roomId = roomId;
  S.reading = { temp: r.temp, hum: r.hum, co2: r.co2 };
  S.lastUpdate = Date.now();
  S.buf.t.push(S.lastUpdate);
  KEYS.forEach(k => S.buf[k].push(S.reading[k]));
  if (S.buf.t.length > 40) { S.buf.t.shift(); KEYS.forEach(k => S.buf[k].shift()); }
  evaluate();
  S.roomId = keep;
  if (!quiet && LIVE.has(S.screen) && S.role) render();
}

/* ---------- history (synthetic; replace with an API call) ---------- */
const RANGES = { '6h': { n: 36, step: 10 * 60e3 }, '24h': { n: 48, step: 30 * 60e3 }, '7d': { n: 56, step: 3 * 3600e3 } };
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function history(k, r) {
  const R = RANGES[r]; const rnd = mulberry(k.length * 977 + r.length * 131 + 7); const end = Date.now(); const vals = [], labels = [];
  for (let i = 0; i < R.n; i++) {
    const d = new Date(end - (R.n - 1 - i) * R.step); const hr = d.getHours() + d.getMinutes() / 60;
    const occ = Math.max(0, Math.sin((hr - 7) / 10 * Math.PI));
    let v;
    if (k === 'temp') v = 25.2 + 3.6 * occ + (rnd() - 0.5) * 0.8;
    else if (k === 'hum') v = 63 - 7 * occ + (rnd() - 0.5) * 3;
    else v = 520 + 560 * occ + (hr > 10 && hr < 11.5 ? 230 : 0) + (rnd() - 0.5) * 70;
    vals.push(v);
    labels.push(r === '7d' ? d.toLocaleDateString(undefined, { weekday: 'short' }) : tShort(d));
  }
  return { vals, labels };
}

/* =====================================================================
   CHART (inline SVG)
   ===================================================================== */
function chartSVG(vals, labels, k, cls, id) {
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
const LIVE = new Set(['home', 'alerts', 'monitor', 'status']);
const TITLES = { alerts: 'Alerts', monitor: 'Monitoring', status: 'Device Status', settings: 'Settings', about: 'About' };

function nav() {
  const items = S.role === 'admin'
    ? [['home', 'Home', 'home'], ['alerts', 'Alerts', 'bell'], ['monitor', 'Monitoring', 'chart'], ['status', 'Devices', 'device'], ['settings', 'Settings', 'sliders']]
    : [['home', 'Home', 'home'], ['alerts', 'Alerts', 'bell'], ['monitor', 'Monitoring', 'chart'], ['about', 'About', 'info']];
  return `<nav class="nav" style="--n:${items.length}" aria-label="Main">${items.map(([id, label, ic]) =>
    `<button data-act="go" data-v="${id}" ${S.screen === id ? 'aria-current="page"' : ''}>${I[ic]}${label}${id === 'alerts' && S.unread ? `<span class="badge" aria-label="${S.unread} new">${S.unread > 9 ? '9+' : S.unread}</span>` : ''}</button>`).join('')}</nav>`;
}

function topbar() {
  const home = S.screen === 'home'; const back = S.screen === 'about' && S.role === 'admin' ? 'settings' : 'home';
  return `<header class="topbar">${home
    ? `${logo(34)}<h1>SafeZone</h1>`
    : `<button data-act="go" data-v="${back}" aria-label="Back to ${back}">${I.back}</button><h1>${TITLES[S.screen]}</h1>`}
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
    ? `<button class="switch" role="switch" aria-checked="${on}" aria-label="Ventilation fan" data-act="toggleVent"><span></span></button>
       ${auto ? '<p class="s-note">Automatic mode</p>' : '<button class="linkbtn" data-act="auto">Manual. Switch to automatic</button>'}`
    : `<span class="chip ${on ? 'normal' : 'idle'}">${auto ? 'Automatic' : 'Manual'}</span>
       ${admin ? '<button class="linkbtn" data-act="toMonitor">Control in Monitoring</button>' : ''}`;
  return `<article class="card sensor"><div class="s-head"><span class="ico ico-fan ${on ? 'spin' : ''}">${I.fan}</span>Ventilation</div>
    <div class="s-val">${on ? 'ON' : 'OFF'}</div>${foot}</article>`;
}

function cards(control = false) { return `<div class="grid2">${sensorCard('temp')}${sensorCard('hum')}${sensorCard('co2')}${ventCard(control)}</div>`; }

function banner() {
  const w = worstName();
  const map = {
    normal: ['leaf', 'Environment Healthy', 'Good air quality and safe conditions.'],
    warning: ['alert', 'Readings Rising', 'One or more readings are near the set limit.'],
    exceeded: ['alert', 'Danger: Limit Exceeded', S.vent.on ? 'Ventilation is on and clearing the air.' : 'Ventilation is off. Turn it on or open a window.']
  }[w];
  return `<div class="banner ${w}" role="status">${I[map[0]]}<div><b>${map[1]}</b><span>${map[2]}</span></div></div>`;
}

const liveLine = () => `<div class="live"><i></i>Live, updated ${tSec(new Date(S.lastUpdate))}</div>`;

// "Select Room" dropdown. Admins also get the Add Room button.
function roomBar() {
  const admin = S.role === 'admin'; const r = cur();
  if (S.rooms.length < 2 && !admin) return '';
  return `<div class="roombar">
    <button class="roompick" data-act="pickRoom" aria-haspopup="dialog" aria-label="Select room. Now showing ${esc(r.name)}, ${floorName(r.floor)}">
      <span class="rp-ico">${I.building}</span>
      <span class="rp-txt"><small>Select Room, ${floorName(r.floor)}</small><b>${esc(r.name)}</b></span>
      <i class="rdot ${roomLevel(r)}"></i><span class="rp-chev">${I.chevd}</span></button>
    ${admin ? `<button class="addroom" data-act="addRoom" aria-label="Add room"><span class="plus">${I.plus}</span><small>Add Room</small></button>` : ''}
  </div>`;
}

function powerCard(compact) {
  const r = cur(); const p = power(r);
  if (compact) {
    return `<button class="card power compact" data-act="toMonitor" aria-label="Power in use, open monitoring"><span class="ico ico-pow">${I.bolt}</span>
      <div><b>${wattsText(p.total)}</b><span>Power in use. ${r.lightsOn} of ${r.lights} lights on.</span></div><span class="chev" style="margin-left:auto">${I.chev}</span></button>`;
  }
  return `<article class="card power"><div class="s-head"><span class="ico ico-pow">${I.bolt}</span>Power usage</div>
    <div class="s-val">${Math.round(p.total).toLocaleString('en-US')}<small>W</small></div>
    <div class="plist">
      <div>${I.bulb}<span>Lights<small>${r.lightsOn} of ${r.lights} on</small></span><b>${wattsText(p.lights)}</b></div>
      <div>${I.fan}<span>Ventilation fan<small>${r.vent.on ? 'Running' : 'Off'}</small></span><b>${wattsText(p.fan)}</b></div>
      <div>${I.device}<span>Other devices<small>Outlets and equipment</small></span><b>${wattsText(p.other)}</b></div>
    </div></article>`;
}

function legendCard() {
  const warnFan = S.fanTrigger === 'warning';
  return `<section class="card legend-card"><h3>Status colors</h3>
    <div class="lg"><i class="dot normal"></i><div><b>Green: Normal</b><span>Readings are within the set limits.</span></div></div>
    <div class="lg"><i class="dot warning"></i><div><b>Yellow: Warning</b><span>Near the limit. SMS alert sent.${warnFan ? ' Ventilation turns ON.' : ''}</span></div></div>
    <div class="lg"><i class="dot exceeded"></i><div><b>Red: Danger</b><span>Limit exceeded. SMS alert sent.${warnFan ? ' Ventilation stays ON.' : ' Ventilation turns ON.'}</span></div></div>
    <p class="legend-foot">In automatic mode, ventilation turns OFF again when every reading is green.</p></section>`;
}

function homeView() {
  const room = esc(cur().name);
  const head = S.role === 'admin'
    ? `<h2>Welcome, Admin!</h2><p class="sub">Here's the current environment in ${room} and the system status.</p>`
    : `<h2>Classroom Environment</h2><p class="sub">Real-time indoor conditions in ${room}.</p>`;
  return `${head}${roomBar()}${liveLine()}${cards()}${powerCard(true)}${banner()}${legendCard()}`;
}

function alertsView() {
  const admin = S.role === 'admin';
  const filters = admin ? [['all', 'All'], ['message', 'Message'], ['exceeded', 'Danger'], ['system', 'System']] : [['all', 'All'], ['exceeded', 'Danger'], ['system', 'System']];
  const list = S.alerts.filter(a => S.alertFilter === 'all' || a.cats.includes(S.alertFilter));
  return `<div class="chips" role="group" aria-label="Filter alerts">${filters.map(([id, l]) => `<button data-act="filter" data-v="${id}" aria-pressed="${S.alertFilter === id}">${l}</button>`).join('')}</div>
    ${list.length ? list.map(a => `<article class="alert ${a.type}"><span class="dot ${a.type}"></span><div><b>${esc(a.title)}</b><p>${esc(a.body)}</p><time>${when(a.ts)}</time>${a.room ? `<span class="tag room">${esc(a.room)}</span>` : ''}${admin && a.sms ? '<span class="tag">SMS sent</span>' : ''}</div></article>`).join('')
      : '<p class="empty">No alerts in this group yet.</p>'}`;
}

function metricChips() {
  return `<div class="mini-chips" role="group" aria-label="Choose reading">${KEYS.map(k => `<button data-act="metric" data-v="${k}" aria-pressed="${S.mon.metric === k}">${METRICS[k].label}</button>`).join('')}</div>`;
}

function monitorView() {
  const k = S.mon.metric; const m = METRICS[k]; const live = S.mon.view === 'live';
  const seg = `<div class="seg" role="group" aria-label="View"><button data-act="view" data-v="live" aria-pressed="${live}">Real-time</button><button data-act="view" data-v="history" aria-pressed="${!live}">History</button></div>`;
  if (live) {
    const labels = S.buf.t.map(t => tSec(new Date(t)));
    return `${seg}${roomBar()}${cards(true)}${powerCard(false)}${metricChips()}
      <section class="card chart-card" style="margin-top:0"><div class="chart-head"><h3>${m.label} (${m.unit})</h3><span class="chip ${S.levels[k]}">${LV[S.levels[k]]}</span></div>
      ${chartSVG(S.buf[k], labels, k, S.levels[k], 'live')}${legend(k)}</section>`;
  }
  const r = S.mon.range; const h = history(k, r); h.vals = h.vals.map(v => v + cur().off[k]);
  const min = Math.min(...h.vals), max = Math.max(...h.vals), avg = h.vals.reduce((a, b) => a + b, 0) / h.vals.length;
  const over = h.vals.filter(v => v >= S.limits[k].limit).length;
  const rc = `<div class="mini-chips" role="group" aria-label="Time range">${[['6h', 'Last 6 hours'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days']].map(([id, l]) => `<button data-act="range" data-v="${id}" aria-pressed="${r === id}">${l}</button>`).join('')}</div>`;
  return `${seg}${roomBar()}${metricChips()}${rc}
    <section class="card"><div class="chart-head"><h3>${m.label} (${m.unit})</h3></div>${chartSVG(h.vals, h.labels, k, 'neutral', 'hist')}${legend(k)}</section>
    <div class="stats"><div class="stat"><span>Lowest</span><b>${fmt(k, min)}</b></div><div class="stat"><span>Average</span><b>${fmt(k, avg)}</b></div><div class="stat"><span>Highest</span><b>${fmt(k, max)}</b></div></div>
    <p class="note">${over ? `${over} reading${over > 1 ? 's' : ''} reached the limit in this period.` : 'No readings reached the limit in this period.'}</p>`;
}

function statusView() {
  const r = S.reading;
  const row = (ic, name, sub, st = 'Online') => `<div class="row"><span class="r-ico">${I[ic]}</span><div class="r-txt"><b>${name}</b><span>${sub}</span></div><span class="pill">${st}</span></div>`;
  return `<h2>All devices online</h2><p class="sub">Connection and sensor health for ${esc(cur().name)}.</p>${roomBar()}${liveLine()}
    <div class="list">
      ${row('cpu', 'ESP32 Controller', 'Sending readings every 2 seconds')}
      ${row('thermo', 'Temperature Sensor', withUnit('temp', r.temp))}
      ${row('drop', 'Humidity Sensor', withUnit('hum', r.hum))}
      ${row('cloud', 'CO₂ Sensor', withUnit('co2', r.co2))}
      ${row('fan', 'Exhaust Fan', S.vent.on ? 'Running' : 'Standing by', S.vent.on ? 'Active' : 'Idle')}
      ${row('wifi', 'Wi-Fi Connection', 'SafeZone_Network', 'Connected')}
      ${row('sms', 'SMS Module', 'Ready to send alerts', 'Ready')}
      ${row('bolt', 'Power Meter', wattsText(power(cur()).total), 'Online')}
    </div>`;
}

function limitBlock(k, hint) {
  const m = METRICS[k]; const t = S.limits[k];
  return `<details class="row-d"><summary><span class="r-ico row" style="width:36px;height:36px;padding:0;border:0;justify-content:center;border-radius:11px;background:var(--brand-soft);color:var(--nav-active)">${I[m.icon]}</span>
    <div class="r-txt"><b>${m.label} Threshold</b><span>${hint}</span></div><span class="chev">${I.chev}</span></summary>
    <div class="fields"><label class="f">Warning at (${m.unit})<input type="number" id="${k}-warn" value="${t.warn}" step="any" inputmode="decimal"></label>
    <label class="f">Limit at (${m.unit})<input type="number" id="${k}-limit" value="${t.limit}" step="any" inputmode="decimal"></label></div></details>`;
}

function settingsView() {
  const trig = S.draftTrigger;
  return `<p class="section-label" style="margin-top:0">Admin account</p>
    <div class="list">
      <button class="row" data-act="users"><span class="r-ico">${I.users}</span><div class="r-txt"><b>Manage Users</b><span>Admins and registered accounts</span></div><span class="chev">${I.chev}</span></button>
      <button class="row" data-act="account"><span class="r-ico">${I.user}</span><div class="r-txt"><b>Account Settings</b><span>Username and password</span></div><span class="chev">${I.chev}</span></button>
    </div>
    <p class="section-label">Rooms and alerts</p>
    <div class="list">
      <button class="row" data-act="addRoom"><span class="r-ico">${I.home}</span><div class="r-txt"><b>Rooms</b><span>Add or remove rooms to monitor</span></div><span class="chev">${I.chev}</span></button>
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
      <div class="row"><span class="r-ico">${I.fan}</span><div class="r-txt"><b>Ventilation Control</b><span>Automatic or manual, for all rooms</span></div>
        <button class="switch" role="switch" id="draft-auto" aria-checked="${S.draftAuto}" aria-label="Automatic ventilation" data-act="draftAuto"><span></span></button></div>
      <div class="row" style="flex-wrap:wrap"><span class="r-ico">${I.fan}</span><div class="r-txt"><b>Turn fan on at</b><span>When automatic ventilation starts</span></div>
        <div class="mini-chips opt2" role="group" aria-label="Turn fan on at" style="flex-basis:100%;margin:0">
          <button data-act="trigger" data-v="warning" aria-pressed="${trig === 'warning'}">Yellow (Warning)</button>
          <button data-act="trigger" data-v="exceeded" aria-pressed="${trig === 'exceeded'}">Red (Danger)</button></div></div>
    </div>
    <div style="margin-top:16px"><button class="btn" data-act="save">Save changes</button></div>
    <p class="section-label">Demo tools</p>
    <div class="stack">
      <button class="btn soft small" data-act="sim" data-v="co2">Simulate high CO₂</button>
      <button class="btn soft small" data-act="sim" data-v="temp">Simulate high temperature</button>
      <button class="btn soft small" data-act="sim" data-v="hum">Simulate high humidity</button>
      <button class="btn soft small" data-act="sim" data-v="reset">Reset readings</button>
    </div>`;
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
      <li><b>Admin dashboard:</b> readings, status and power use for each room, with the system status.</li>
      <li><b>Rooms:</b> add a room with the + button. The number follows the floor, such as 101, 201, 301 or 401. Remove rooms in Settings.</li>
      <li><b>Ventilation control:</b> turn the fan on or off in Monitoring, or leave it in Automatic mode. Choose whether it starts at yellow or red.</li>
      <li><b>Thresholds:</b> set the warning and limit for temperature, humidity and CO₂.</li>
      <li><b>SMS Alerts:</b> choose who receives texts, with name, role and mobile number. Switch people on or off, edit or remove them.</li>
      <li><b>Manage Users:</b> see admin and registered accounts, and add other admins.</li>
      <li><b>Account Settings:</b> change your own password.</li>
      <li><b>Device status:</b> check the controller, sensors, fan, Wi-Fi, SMS module and power meter.</li>
      <li><b>Alerts and history:</b> review warnings, danger alerts and charts for the last 6 hours, 24 hours or 7 days.</li></ul>`
  : `<ul>
      <li><b>Real-time readings:</b> temperature, humidity and CO₂ for the room you choose.</li>
      <li><b>Room status:</b> green, yellow and red indicators show the room's condition.</li>
      <li><b>Ventilation status:</b> see whether the exhaust fan is running, and whether it is in Automatic or Manual mode.</li>
      <li><b>Room selection:</b> pick a room by floor.</li>
      <li><b>Power usage:</b> watts in use and how many lights are on.</li>
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
  const bodies = { home: homeView, alerts: alertsView, monitor: monitorView, status: statusView, settings: settingsView, about: aboutView };
  return `${topbar()}<main class="screen" id="screen" data-s="${S.screen}">${bodies[S.screen]()}</main>${nav()}`;
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
const rulesList = () => `<ul class="rules" id="rules" aria-label="Password rules">${pwRules('').map(([t, ok]) => `<li class="${ok ? 'ok' : ''}">${I.check}${t}</li>`).join('')}</ul>`;
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
    ${circle('cap')}
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
    <button class="linkbtn" style="margin-top:10px;font-size:13px" data-act="to" data-v="fReg">Create an admin account</button>
    <p class="note" style="margin-top:14px">Prototype login: admin / safezone</p>
  </div></div>`;
}

function fRegView() {
  return `<div class="splash auth">${authBack('login')}<div class="auth-in">
    ${circle('sliders')}
    <h2>Admin Account</h2>
    <p class="tag-line" style="margin-bottom:18px">Create an account to manage and control SafeZone.</p>
    <form id="f-reg-form" style="width:100%" autocomplete="off" novalidate>
      ${textField('user', 'fname', 'Full name', 'text', 'autocomplete="name"')}
      ${textField('user', 'fuser', 'Username', 'text', 'autocapitalize="none" autocomplete="username"')}
      ${textField('mail', 'femail', 'PUP web mail', 'email', 'inputmode="email" autocapitalize="none" autocomplete="email"')}
      <p class="hint">${emailHintHtml}</p>
      ${textField('phone', 'fphone', 'Mobile number (09XXXXXXXXX)', 'tel', 'inputmode="numeric" autocomplete="tel"')}
      ${pwField('rp', 'Password', 'new-password')}
      ${rulesList()}
      ${pwField('rc', 'Confirm password', 'new-password')}
      ${textField('key', 'fcode', 'Admin access code', 'text', 'autocapitalize="characters" autocomplete="off"')}
      <p class="hint">Ask your system administrator for the admin access code.</p>
      ${errLine()}
      <button class="btn" type="submit">Create Account</button>
    </form>
  </div></div>`;
}

/* ---------- Forgot password: web mail, code, new password ---------- */
function resetAccount(r) { return S.accounts.find(a => a.role === (r.side === 'admin' ? 'admin' : 'viewer') && a.email && a.email === r.email); }
function sendResetCode() {
  const r = S.reset; const acc = resetAccount(r);
  r.code = acc ? newCode() : null;      // the real system answers the same either way and only emails when the account exists
  r.exp = Date.now() + RESET_MINUTES * 60e3; r.tries = 0; r.sentAt = Date.now(); r.ok = false; r.demo = SHOW_DEMO_CODE && !EMAIL_ON;
}

// Emails the code when EMAIL_SEND is filled in. Returns true (sent), false (failed) or null (demo mode, or no account to email).
async function deliverCode() {
  const r = S.reset;
  if (!EMAIL_ON || !r || !r.code) return null;
  try {
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAIL_SEND.serviceId, template_id: EMAIL_SEND.templateId, user_id: EMAIL_SEND.publicKey,
        template_params: { to_email: r.email, code: r.code, minutes: RESET_MINUTES, app_name: 'SafeZone' }
      })
    });
    return !!res.ok;
  } catch (e) { return false; }
}

function fpEmailView() {
  const admin = S.reset && S.reset.side === 'admin';
  return `<div class="splash auth">${authBack(admin ? 'login' : 'vLogin')}<div class="auth-in">
    ${circle('mail')}
    <h2>Forgot Password</h2>
    <p class="tag-line" style="margin-bottom:20px">Enter your PUP web mail. We will send a 6-digit code to it.</p>
    <form id="fp-email-form" style="width:100%" novalidate>
      <label class="flabel" for="fpe">PUP Web Mail</label>
      ${emailInput('fpe', S.reset ? S.reset.email : '')}
      <p class="hint">${emailHintHtml}</p>
      ${errLine()}
      <button class="btn" type="submit">Send code</button>
    </form>
  </div></div>`;
}

function fpCodeView() {
  const r = S.reset;
  const demo = r.demo ? `<div class="demo-note" role="note"><b>Demo only</b><span>${r.code ? 'The prototype cannot send real email, so your code is shown here. The real system sends it to your web mail inbox.' : 'No account uses this web mail, so no code was sent. The real system shows the same message either way.'}</span>${r.code ? `<strong class="demo-code" id="demo-code">${r.code}</strong>` : ''}</div>` : '';
  return `<div class="splash auth">${authBack('fpEmail')}<div class="auth-in">
    ${circle('key')}
    <h2>Enter Code</h2>
    <p class="tag-line" style="margin-bottom:16px;max-width:100%">If <b>${esc(maskEmail(r.email))}</b> is registered, we sent a 6-digit code to it. The code works for ${RESET_MINUTES} minutes.${EMAIL_ON ? '<br>Check your Junk folder if you do not see it.' : ''}</p>
    ${demo}
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
  return `<div class="splash auth">${authBack('fpEmail')}<div class="auth-in">
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

function render() {
  const view = $('#view'); const prev = $('#screen');
  const top = prev && prev.dataset.s === S.screen ? prev.scrollTop : 0;
  const AUTH = { splash: splashView, login: loginView, fReg: fRegView, vWelcome: vWelcomeView, vLogin: vLoginView, vReg1: vReg1View, vReg2: vReg2View, vDone: vDoneView, fpEmail: fpEmailView, fpCode: fpCodeView, fpNew: fpNewView, fpDone: fpDoneView };
  view.innerHTML = AUTH[S.screen] ? AUTH[S.screen]() : shell();
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
  const prev = $('#sheet-root .sheet'); const keep = prev && prev.getAttribute('aria-label') === title ? prev.scrollTop : 0;
  $('#sheet-root').innerHTML = `<div class="overlay" data-act="closeSheet" data-overlay="1"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div>
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="x" data-act="closeSheet" aria-label="Close">${I.x}</button></div>${html}</div></div>`;
  const sh = $('#sheet-root .sheet'); if (sh) { sh.setAttribute('tabindex', '-1'); sh.focus({ preventScroll: true }); sh.scrollTop = keep; }
}
const closeSheet = () => { $('#sheet-root').innerHTML = ''; };

function usersSheet() {
  const admins = S.accounts.filter(a => a.role === 'admin'); const viewers = S.accounts.filter(a => a.role === 'viewer');
  const mine = S.me ? S.me.username : '';
  openSheet('Manage Users', `<p class="section-label" style="margin-top:0">Admins (${admins.length})</p>
    <div class="list">${admins.map(a => `<div class="user-row"><div><b>${esc(a.name)}</b><span>@${esc(a.username)}, ${esc(showPhone(a.phone))}</span>${a.email ? `<span style="display:block">${esc(a.email)}</span>` : ''}</div>${a.username === mine ? '<span class="pill">You</span>' : ''}</div>`).join('')}</div>
    <p class="section-label">Student / Faculty accounts (${viewers.length})</p>
    <div class="list">${viewers.length ? viewers.map(v => `<div class="user-row"><div><b>${esc(showPhone(v.phone))}</b><span>${esc(v.email || 'No web mail yet')}</span></div></div>`).join('') : '<p class="empty">No one has registered yet.</p>'}</div>
    <p class="note">Who gets SMS alerts is set in Settings, under SMS Alerts.</p>
    <p class="section-label">Add another admin</p>
    <p class="note" style="margin:0 4px 10px">Give someone else admin access. They log in with the username and password you set here, and can change the password later in Account Settings.</p>
    <form id="admin-form" class="stack" autocomplete="off" novalidate>
      ${textField('user', 'an', 'Full name', 'text', 'autocomplete="off"')}
      ${textField('user', 'au', 'Username', 'text', 'autocapitalize="none" autocomplete="off"')}
      ${textField('mail', 'aem', 'PUP web mail', 'email', 'inputmode="email" autocapitalize="none" autocomplete="off"')}
      ${textField('phone', 'ap', 'Mobile number (09XXXXXXXXX)', 'tel', 'inputmode="numeric" autocomplete="off"')}
      ${pwField('rp', 'Password for the new admin', 'new-password')}
      ${rulesList()}
      <button class="btn small" type="submit">Add admin</button>
    </form>`);
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
  const admin = S.role === 'admin'; const now = cur().id;
  openSheet('Select Room', floorList().map(f => {
    const rooms = roomsOn(f);
    return `<div class="floor"><div class="floor-head"><b>${floorName(f)}</b>${admin ? `<button class="linkbtn" data-act="addRoom" data-v="${f}">+ Add room</button>` : ''}</div>
      ${rooms.length ? rooms.map(r => `<button class="room-opt" data-act="room" data-v="${r.id}" aria-pressed="${r.id === now}"><i class="rdot ${roomLevel(r)}"></i><span>${esc(r.name)}</span>${r.id === now ? I.check : ''}</button>`).join('') : '<p class="floor-empty">No rooms yet</p>'}</div>`;
  }).join(''));
}

// Rooms: add a room to any floor, or remove one.
function roomsSheet() {
  const f0 = S.addFloor || 1; const sug = nextRoomNumber(f0);
  const groups = floorList().map(f => {
    const rooms = roomsOn(f); if (!rooms.length) return '';
    return `<p class="section-label" style="margin:14px 4px 6px">${floorName(f)}</p><div class="list">${rooms.map(r => {
      const armed = S.pendingDel === 'room:' + r.id;
      return `<div class="user-row"><div><b>${esc(r.name)}</b><span>${r.lights} lights at ${r.lightWatts} W, fan ${r.fanWatts} W</span></div>
        <button class="x del ${armed ? 'armed' : ''}" data-act="roomDel" data-v="${r.id}" aria-label="Remove ${esc(r.name)}">${armed ? 'Remove?' : I.trash}</button></div>`;
    }).join('')}</div>`;
  }).join('');
  openSheet('Rooms', `<p class="section-label" style="margin-top:0">Add a room</p>
    <form id="room-form" class="stack" autocomplete="off" novalidate>
      <p class="flabel" style="margin:0">Floor</p>
      <div class="mini-chips" role="group" aria-label="Floor" style="margin:0">${floorList().map(f => `<button type="button" data-act="floor" data-v="${f}" aria-pressed="${f === f0}">${ord(f)}</button>`).join('')}</div>
      <div class="field roomno">${I.home}<span class="rpre">Room</span><input type="number" id="rn" value="${sug || ''}" min="${f0 * 100 + 1}" max="${f0 * 100 + 99}" inputmode="numeric" aria-label="Room number"></div>
      <p class="hint" id="rnhint" style="margin:-4px 2px 0">${floorHint(f0)}</p>
      <div class="fields3">
        <label class="f">Lights<input type="number" id="rl" value="${ROOM_DEFAULTS.lights}" min="0" max="100" inputmode="numeric"></label>
        <label class="f">Watts per light<input type="number" id="rw" value="${ROOM_DEFAULTS.lightWatts}" min="1" step="any" inputmode="decimal"></label>
        <label class="f">Fan watts<input type="number" id="rf" value="${ROOM_DEFAULTS.fanWatts}" min="0" step="any" inputmode="decimal"></label>
      </div>
      <p class="note" style="margin:0">The lights and fan numbers are used for the power display.</p>
      <button class="btn small" type="submit">Add room</button>
    </form>
    <p class="section-label">Current rooms</p>${groups}`);
}

function accountSheet() {
  const me = S.me; if (!me) return;
  openSheet('Account Settings', `<div class="stack"><label class="f">Name<input type="text" value="${esc(me.name)}" disabled></label>
    <label class="f">Username<input type="text" value="${esc(me.username)}" disabled></label></div>
    <p class="section-label">PUP web mail</p>
    <form id="email-form" class="stack" novalidate>
      ${emailInput('ae', me.email || '')}
      <p class="note" style="margin:0">Used to verify you if you forget your password.<br>${emailHintHtml}</p>
      <button class="btn small" type="submit">Save web mail</button>
    </form>
    <p class="section-label">Change password</p>
    <form id="pw-form" class="stack" novalidate><input type="password" id="np" placeholder="New password" aria-label="New password" autocomplete="new-password"><input type="password" id="cp" placeholder="Confirm new password" aria-label="Confirm new password" autocomplete="new-password"><p class="note" style="margin:0">At least 6 characters, with a letter and a number, and no spaces.</p><button class="btn small" type="submit">Update password</button></form>`);
}

/* =====================================================================
   ACTIONS
   ===================================================================== */
const ACTS = {
  go(v) {
    S.screen = v; if (v === 'alerts') S.unread = 0;
    if (v === 'settings') { S.draftAuto = S.rooms.every(r => r.vent.mode === 'auto'); S.draftTrigger = S.fanTrigger; }
    render();
  },
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
      <button class="btn soft" data-act="logout">Log out</button></div>`);
  },
  logout() { S.role = null; S.me = null; S.session = null; S.reg = { phone: '' }; S.screen = 'splash'; S.unread = 0; store.save(); closeSheet(); render(); },
  toggleVent() {
    S.vent.mode = 'manual'; S.vent.on = !S.vent.on; S.draftAuto = false; store.save();
    pushAlert({ type: 'ventilation', cats: ['system'], title: `Ventilation turned ${S.vent.on ? 'ON' : 'OFF'}`, body: 'Switched manually by an admin.' }, true);
    render(); toast(`Ventilation ${S.vent.on ? 'on' : 'off'}. Manual mode.`);
  },
  auto() { S.vent.mode = 'auto'; S.draftAuto = true; store.save(); evaluate(); render(); toast('Automatic ventilation is on'); },
  metric(v) { S.mon.metric = v; render(); },
  view(v) { S.mon.view = v; render(); },
  range(v) { S.mon.range = v; render(); },
  filter(v) { S.alertFilter = v; render(); },
  pw(v, el) {
    const inp = $('#' + v); if (!inp) return;
    const show = inp.type === 'password'; inp.type = show ? 'text' : 'password';
    el.innerHTML = show ? I.eyeoff : I.eye; el.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  },
  forgot(v) {
    S.reset = { side: v === 'admin' ? 'admin' : 'viewer', email: '', code: null, exp: 0, tries: 0, sentAt: 0, ok: false, okExp: 0, demo: false };
    S.authError = ''; S.notice = ''; S.screen = 'fpEmail'; render();
  },
  async fpResend() {
    const r = S.reset; if (!r) return;
    const wait = Math.ceil((r.sentAt + RESEND_SECONDS * 1000 - Date.now()) / 1000);
    if (wait > 0) { toast(`Please wait ${wait} seconds before asking for a new code.`); return; }
    sendResetCode();
    const sent = await deliverCode();
    if (sent === false) { r.code = null; r.sentAt = 0; toast('We could not send the email. Try again.'); return; }
    S.authError = ''; render(); toast(sent ? 'A new code was sent to your web mail.' : 'A new code was sent.');
  },
  closeSheet(v, el, e) { if (el.dataset.overlay && e.target !== el) return; closeSheet(); },
  users: usersSheet, account: accountSheet,
  sms() { S.pendingDel = ''; smsSheet(); },
  smsEdit(v) { S.pendingDel = ''; smsSheet(+v); },
  smsCancel() { S.pendingDel = ''; smsSheet(); },
  smsDel(v) {
    const key = 'sms:' + v;
    if (S.pendingDel !== key) { S.pendingDel = key; smsSheet(); return; }       // first tap asks "Remove?"
    S.users.splice(+v, 1); S.pendingDel = ''; store.save(); smsSheet(); toast('Recipient removed');
  },
  userSms(v) { const u = S.users[+v]; u.sms = !u.sms; store.save(); smsSheet(); },
  pickRoom() { pickSheet(); },
  room(v) { if (S.rooms.some(r => r.id === v)) { S.roomId = v; store.save(); closeSheet(); render(); } },
  addRoom(v) { if (S.role !== 'admin') return; S.addFloor = v ? +v : cur().floor; S.pendingDel = ''; roomsSheet(); },
  floor(v) {
    S.addFloor = +v;
    document.querySelectorAll('[data-act="floor"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    const rn = $('#rn'); if (rn) { rn.value = nextRoomNumber(S.addFloor) || ''; rn.min = S.addFloor * 100 + 1; rn.max = S.addFloor * 100 + 99; }
    const hint = $('#rnhint'); if (hint) hint.textContent = floorHint(S.addFloor);
  },
  roomDel(v) {
    if (S.role !== 'admin') return;
    if (S.rooms.length <= 1) { toast('Keep at least one room.'); return; }
    const key = 'room:' + v;
    if (S.pendingDel !== key) { S.pendingDel = key; roomsSheet(); return; }
    S.rooms = S.rooms.filter(r => r.id !== v); if (!S.rooms.some(r => r.id === S.roomId)) S.roomId = S.rooms[0].id;
    S.pendingDel = ''; store.save(); roomsSheet(); render(); toast('Room removed');
  },
  theme() {
    S.theme = effectiveDark() ? 'light' : 'dark'; applyTheme(); store.save();
    if ($('#sheet-root .sheet')) ACTS.menu(); else render();
  },
  trigger(v) { S.draftTrigger = v; document.querySelectorAll('[data-act="trigger"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); },
  draftAuto(v, el) { S.draftAuto = !S.draftAuto; el.setAttribute('aria-checked', S.draftAuto); },
  save() {
    const next = {};
    for (const k of KEYS) {
      const w = parseFloat($(`#${k}-warn`).value), l = parseFloat($(`#${k}-limit`).value);
      if (!isFinite(w) || !isFinite(l)) { toast(`Enter numbers for ${METRICS[k].label}.`); return; }
      if (w >= l) { toast(`${METRICS[k].label}: the warning must be lower than the limit.`); return; }
      next[k] = { warn: w, limit: l };
    }
    S.limits = next; S.fanTrigger = S.draftTrigger;
    S.rooms.forEach(r => { r.vent.mode = S.draftAuto ? 'auto' : 'manual'; });
    store.save();
    eachRoom(r => { KEYS.forEach(k => { r.levels[k] = levelOf(k, r.reading[k]); }); r.prevWorst = worst(); evaluate(); });
    render(); toast('Changes saved');
  },
  sim(v) {
    const name = cur().name;
    if (v === 'reset') {
      S.scenario = null; S.reading = roomBase(cur()); S.vent = { mode: 'auto', on: false }; S.draftAuto = true;
      KEYS.forEach(k => { S.levels[k] = 'normal'; }); S.prevWorst = 0; render(); toast(`${name} reset`); return;
    }
    S.scenario = v; S.vent.mode = 'auto'; S.draftAuto = true;
    toast(`Simulating high ${v === 'co2' ? 'CO₂' : v === 'temp' ? 'temperature' : 'humidity'} in ${name}. Watch the Alerts tab.`);
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = ACTS[el.dataset.act]; if (fn) fn(el.dataset.v, el, e);
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const id = e.target.id;
  const fail = msg => { S.authError = msg; const el = $('#err'); if (el) el.textContent = msg; };
  const ready = () => { S.authError = ''; S.notice = ''; S.reg = { phone: '' }; S.screen = 'home'; render(); };

  if (id === 'login-form') {                                   // Admin login
    const u = $('#u').value.trim().toLowerCase(), p = $('#pw').value;
    const acc = S.accounts.find(a => a.role === 'admin' && a.username === u);
    if (acc && acc.hash === await hashPw(acc.username, p)) { S.me = acc; S.role = 'admin'; ready(); }
    else fail('Wrong username or password. Check both and try again.');

  } else if (id === 'f-reg-form') {                            // Admin registration
    const name = $('#fname').value.trim(), user = $('#fuser').value.trim().toLowerCase(), raw = $('#fphone').value, mail = normEmail($('#femail').value);
    const p = $('#rp').value, c = $('#rc').value, code = $('#fcode').value.trim();
    if (!name || !user) return fail('Enter your full name and a username.');
    if (!/^[a-z0-9._-]{3,20}$/.test(user)) return fail('Username: 3 to 20 letters, numbers, dots, dashes or underscores.');
    if (S.accounts.some(a => a.role === 'admin' && a.username === user)) return fail('That username is taken. Try another.');
    if (!emailKind(mail)) return fail('Use your PUP web mail. ' + emailHint);
    if (emailTaken(mail)) return fail('That web mail is already used by another account.');
    if (!validPhone(raw)) return fail('Enter a valid Philippine mobile number, like 09XXXXXXXXX.');
    if (!pwRules(p).every(r => r[1])) return fail('Your password does not meet all the rules above.');
    if (p !== c) return fail('The two passwords do not match.');
    if (code.toUpperCase() !== ADMIN_CODE.toUpperCase()) return fail('Wrong admin access code.');
    const phone = normPhone(raw);
    S.accounts.push({ role: 'admin', username: user, name, phone, email: mail, hash: await hashPw(user, p) });
    if (!S.users.some(u => normPhone(u.phone) === phone)) S.users.push({ name, role: 'Admin', phone: showPhone(phone), sms: true });
    store.save(); S.authError = ''; S.notice = 'Account created. You can log in now.'; S.screen = 'login'; render();

  } else if (id === 'v-reg1-form') {                           // Student / Faculty: step 1, web mail + mobile number
    const email = normEmail($('#email').value), raw = $('#phone').value, phone = normPhone(raw);
    if (!emailKind(email)) return fail('Use your PUP web mail. ' + emailHint);
    if (!validPhone(raw)) return fail('Enter a valid Philippine mobile number, like 09XXXXXXXXX.');
    if (emailTaken(email)) return fail('This web mail is already registered. Go back and log in.');
    if (S.accounts.some(a => a.role === 'viewer' && a.phone === phone)) return fail('This number is already registered. Go back and log in.');
    S.reg.email = email; S.reg.phone = phone; S.authError = ''; S.screen = 'vReg2'; render();

  } else if (id === 'v-reg2-form') {                           // Student / Faculty: step 2, password
    const p = $('#rp').value, c = $('#rc').value, phone = S.reg.phone, email = S.reg.email;
    if (!phone || !email) { S.screen = 'vReg1'; render(); return; }
    if (!pwRules(p).every(r => r[1])) return fail('Your password does not meet all the rules above.');
    if (p !== c) return fail('The two passwords do not match.');
    const kind = emailKind(email) || 'student';
    S.accounts.push({ role: 'viewer', phone, email, kind, hash: await hashPw(phone, p) });
    if (!S.users.some(u => normPhone(u.phone) === phone)) S.users.push({ name: 'Unnamed user', role: kind === 'faculty' ? 'Faculty' : 'Student', phone: showPhone(phone), sms: true });
    store.save(); S.authError = ''; S.screen = 'vDone'; render();

  } else if (id === 'fp-email-form') {                         // forgot password: step 1, web mail
    const email = normEmail($('#fpe').value);
    if (!emailKind(email)) return fail('Enter your PUP web mail. ' + emailHint);
    const btn = e.target.querySelector('button[type="submit"]'); if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    S.reset.email = email; sendResetCode();
    const sent = await deliverCode();
    if (sent === false) {
      S.reset.code = null; S.reset.sentAt = 0;
      if (btn) { btn.disabled = false; btn.textContent = 'Send code'; }
      return fail('We could not send the email. Check your internet connection and try again.');
    }
    S.authError = ''; S.screen = 'fpCode'; render();

  } else if (id === 'fp-code-form') {                          // forgot password: step 2, 6-digit code
    const r = S.reset; if (!r) { S.screen = 'fpEmail'; render(); return; }
    const code = $('#fpc').value.trim();
    if (!/^\d{6}$/.test(code)) return fail('Enter the 6-digit code.');
    if (r.tries >= RESET_TRIES) return fail('Too many wrong tries. Send a new code.');
    if (Date.now() > r.exp) return fail('This code has expired. Send a new code.');
    if (!r.code || code !== r.code) {
      r.tries++; const left = RESET_TRIES - r.tries;
      return fail(left <= 0 ? 'Too many wrong tries. Send a new code.' : `That code is not correct. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
    }
    r.ok = true; r.okExp = Date.now() + RESET_MINUTES * 60e3; r.code = null; S.authError = ''; S.screen = 'fpNew'; render();

  } else if (id === 'fp-new-form') {                           // forgot password: step 3, new password
    const r = S.reset; const p = $('#rp').value, c = $('#rc').value;
    if (!r || !r.ok || Date.now() > r.okExp) { S.authError = ''; S.screen = 'fpEmail'; render(); toast('Please verify your web mail again.'); return; }
    if (!pwRules(p).every(x => x[1])) return fail('Your password does not meet all the rules above.');
    if (p !== c) return fail('The two passwords do not match.');
    const acc = resetAccount(r); if (!acc) { S.screen = 'fpEmail'; render(); return; }
    acc.hash = await hashPw(acc.role === 'admin' ? acc.username : acc.phone, p);
    if (S.session === acc.phone) S.session = null;
    S.resetSide = r.side; S.reg = { phone: acc.role === 'viewer' ? acc.phone : '' }; S.reset = null; store.save(); S.authError = ''; S.screen = 'fpDone'; render();

  } else if (id === 'v-login-form') {                          // Student login
    const phone = normPhone($('#phone').value), p = $('#pw').value;
    const acc = S.accounts.find(a => a.role === 'viewer' && a.phone === phone);
    if (acc && acc.hash === await hashPw(acc.phone, p)) { S.me = acc; S.role = 'student'; S.session = acc.phone; store.save(); ready(); }
    else fail('Wrong mobile number or password. Check both and try again.');

  } else if (id === 'admin-form') {                            // an admin gives another person admin access
    const name = $('#an').value.trim(), user = $('#au').value.trim().toLowerCase(), raw = $('#ap').value, p = $('#rp').value, mail = normEmail($('#aem').value);
    if (!name || !user) { toast('Enter the new admin\'s full name and a username.'); return; }
    if (!/^[a-z0-9._-]{3,20}$/.test(user)) { toast('Username: 3 to 20 letters, numbers, dots, dashes or underscores.'); return; }
    if (S.accounts.some(a => a.role === 'admin' && a.username === user)) { toast('That username is taken. Try another.'); return; }
    if (!emailKind(mail)) { toast('Use a PUP web mail. ' + emailHint); return; }
    if (emailTaken(mail)) { toast('That web mail is already used by another account.'); return; }
    if (!validPhone(raw)) { toast('Enter a valid Philippine mobile number, like 09XXXXXXXXX.'); return; }
    if (!pwRules(p).every(r => r[1])) { toast('Password needs 6+ characters with a letter and a number, no spaces.'); return; }
    const phone = normPhone(raw);
    S.accounts.push({ role: 'admin', username: user, name, phone, email: mail, hash: await hashPw(user, p) });
    const known = S.users.find(u => normPhone(u.phone) === phone);
    if (known) { known.role = 'Admin'; known.name = name; known.sms = true; }
    else S.users.push({ name, role: 'Admin', phone: showPhone(phone), sms: true });
    store.save(); usersSheet(); toast(name + ' is now an admin');

  } else if (id === 'sms-form') {                              // SMS recipient: name, role, mobile number
    const edit = parseInt(e.target.dataset.edit, 10);
    const name = $('#sn').value.trim(), role = $('#sr').value, raw = $('#sp').value;
    if (!name) { toast('Enter the person\'s name.'); return; }
    if (!role) { toast('Choose their role.'); return; }
    if (!validPhone(raw)) { toast('Enter a valid Philippine mobile number, like 09XXXXXXXXX.'); return; }
    const phone = normPhone(raw);
    if (S.users.some((u, i) => i !== edit && normPhone(u.phone) === phone)) { toast('That number is already in the list.'); return; }
    if (edit >= 0 && S.users[edit]) Object.assign(S.users[edit], { name, role, phone: showPhone(phone) });
    else S.users.push({ name, role, phone: showPhone(phone), sms: true });
    S.pendingDel = ''; store.save(); smsSheet(); toast(edit >= 0 ? 'Recipient updated' : 'Recipient added');

  } else if (id === 'room-form') {                             // add a room to a floor
    const floor = S.addFloor || 1; const lo = floor * 100 + 1, hi = floor * 100 + 99;
    const no = parseInt($('#rn').value, 10); const name = 'Room ' + no;
    const lights = parseInt($('#rl').value, 10), lw = parseFloat($('#rw').value), fw = parseFloat($('#rf').value);
    if (!(no >= lo && no <= hi)) { toast(`${ord(floor)} floor rooms are numbered ${lo}, ${lo + 1}, ${lo + 2} and so on, up to ${hi}.`); return; }
    if (S.rooms.some(r => r.name.toLowerCase() === name.toLowerCase())) { toast(`${name} already exists.`); return; }
    if (!(lights >= 0 && lights <= 100)) { toast('Lights: enter a number from 0 to 100.'); return; }
    if (!(lw > 0 && lw <= 500)) { toast('Watts per light: enter a number from 1 to 500.'); return; }
    if (!(fw >= 0 && fw <= 2000)) { toast('Fan watts: enter a number from 0 to 2000.'); return; }
    const room = makeRoom({ name, floor, lights, lightWatts: lw, fanWatts: fw });
    KEYS.forEach(k => { room.levels[k] = levelOf(k, room.reading[k]); });
    S.rooms.push(room); S.roomId = room.id; S.pendingDel = ''; store.save(); closeSheet(); render(); toast(`${name} added to the ${floorName(floor)}`);

  } else if (id === 'email-form') {                            // admin saves their own web mail
    const mail = normEmail($('#ae').value);
    if (!emailKind(mail)) { toast('Use your PUP web mail. ' + emailHint); return; }
    if (emailTaken(mail, S.me)) { toast('That web mail is already used by another account.'); return; }
    S.me.email = mail; store.save(); toast('Web mail saved');

  } else if (id === 'pw-form') {
    const a = $('#np').value, b = $('#cp').value;
    if (!pwRules(a).every(r => r[1])) { toast('Use 6+ characters with a letter and a number, no spaces.'); return; }
    if (a !== b) { toast('The two passwords do not match.'); return; }
    S.me.hash = await hashPw(S.me.username, a); store.save(); closeSheet(); toast('Password updated');
  }
});

// Live tick marks on the password rules while typing.
document.addEventListener('input', e => {
  if (e.target.id !== 'rp') return;
  const ul = $('#rules'); if (!ul) return;
  const res = pwRules(e.target.value);
  ul.querySelectorAll('li').forEach((li, i) => li.classList.toggle('ok', res[i][1]));
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* =====================================================================
   INIT
   ===================================================================== */
(async function init() {
  const saved = store.load();
  if (saved) {
    if (saved.limits) S.limits = saved.limits;
    if (saved.users) S.users = saved.users;
    if (saved.accounts) S.accounts = saved.accounts;
    if (saved.session) S.session = saved.session;
    if (saved.fanTrigger) S.fanTrigger = saved.fanTrigger;
    if (saved.theme === 'light' || saved.theme === 'dark') S.theme = saved.theme;
  }
  S.draftTrigger = S.fanTrigger;
  let roomCfg = saved && saved.rooms && saved.rooms.length ? saved.rooms : DEFAULT_ROOMS.map(r => ({ ...r, mode: saved && saved.mode }));
  const updateRooms = !!(saved && saved.rooms && saved.roomsV !== ROOMS_V);
  if (updateRooms) {
    // One-time update: remove the old demo room (Room 201, never edited) and add rooms 101 to 110. Rooms an admin added stay.
    roomCfg = roomCfg.filter(r => !(r.name === 'Room 201' && num(r.lights, 8) === 8 && num(r.lightWatts, 18) === 18 && num(r.fanWatts, 40) === 40));
    DEFAULT_ROOMS.forEach(d => { if (!roomCfg.some(r => r.name.toLowerCase() === d.name.toLowerCase())) roomCfg.push({ ...d }); });
  }
  S.rooms = roomCfg.map(makeRoom).sort((a, b) => a.floor - b.floor || roomNo(a) - roomNo(b));
  S.roomId = saved && S.rooms.some(r => r.id === saved.roomId) ? saved.roomId : S.rooms[0].id;
  S.rooms.forEach(r => KEYS.forEach(k => { r.levels[k] = levelOf(k, r.reading[k]); }));
  if (updateRooms) store.save();
  // Older saved data used 'faculty' for admin accounts. Convert it.
  S.accounts.forEach(a => { if (a.role === 'faculty') a.role = 'admin'; });
  const adminNames = new Set(S.accounts.filter(a => a.role === 'admin').map(a => a.name));
  S.users.forEach(u => { if (u.role === 'Faculty' && adminNames.has(u.name)) u.role = 'Admin'; });
  // The demo admin account always exists, so you can log in on a fresh install.
  if (!S.accounts.some(a => a.role === 'admin' && a.username === DEFAULT_ADMIN.username)) {
    S.accounts.push({ role: 'admin', username: DEFAULT_ADMIN.username, name: DEFAULT_ADMIN.name, phone: DEFAULT_ADMIN.phone,
      hash: await hashPw(DEFAULT_ADMIN.username, DEFAULT_ADMIN.password) });
    store.save();
  }
  // Keep students logged in on this phone until they log out.
  const me = S.session && S.accounts.find(a => a.role === 'viewer' && a.phone === S.session);
  if (me) { S.me = me; S.role = 'student'; S.screen = 'home'; }
  S.users.forEach(u => {
    if (u.role === 'Registered') { u.role = 'Student / Faculty'; if (u.name === 'Student / Faculty user') u.name = 'Unnamed user'; }
    if (u.role === 'Recipient') u.role = 'Other';
  });
  S.draftAuto = S.rooms.every(r => r.vent.mode === 'auto');
  seedAlerts();
  applyTheme();
  render();
  setInterval(tick, 2000);
})();
})();