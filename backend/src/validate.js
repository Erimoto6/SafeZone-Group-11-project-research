// The same rules the app uses, checked again on the server (never trust the phone alone).
const WEBMAIL = { student: 'iskolarngbayan.pup.edu.ph', faculty: 'pup.edu.ph' };

const normPhone = x => { let d = String(x == null ? '' : x).replace(/\D/g, ''); if (d.startsWith('63')) d = '0' + d.slice(2); return d; };
const validPhone = x => /^09\d{9}$/.test(normPhone(x));
const normEmail = x => String(x == null ? '' : x).trim().toLowerCase();

// 'student' | 'faculty' | null. Only the two PUP web mail domains are accepted (no subdomains, no look-alikes).
const emailKind = x => {
  const m = normEmail(x).match(/^[a-z0-9][a-z0-9._-]*@([a-z0-9.-]+)$/);
  if (!m) return null;
  return m[1] === WEBMAIL.student ? 'student' : m[1] === WEBMAIL.faculty ? 'faculty' : null;
};

// Returns a message when the password is not allowed, or null when it is fine.
const passwordProblem = p => {
  if (typeof p !== 'string' || !p) return 'Password is required.';
  if (p.length < 6) return 'Use at least 6 characters.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Include a letter and a number.';
  if (/\s/.test(p)) return 'Passwords cannot have spaces.';
  if (Buffer.byteLength(p) > 72) return 'Use at most 72 characters.';   // bcrypt only reads 72 bytes
  return null;
};

const normUsername = x => String(x == null ? '' : x).trim().toLowerCase();
const validUsername = x => /^[a-z0-9._-]{3,20}$/.test(x);
const cleanName = x => String(x == null ? '' : x).trim().replace(/\s+/g, ' ');

module.exports = { WEBMAIL, normPhone, validPhone, normEmail, emailKind, passwordProblem, normUsername, validUsername, cleanName };
