// Run with:  npm run create-admin
// Creates an admin account. The password is typed here (hidden) and saved as a bcrypt hash.
require('dotenv').config({ quiet: true });
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const v = require('../src/validate');
const { createUser } = require('../src/users');

// Optional: --name="..." --username=... --email=... --phone=... --password=...   (skips the questions)
const flags = {};
for (const a of process.argv.slice(2)) { const m = a.match(/^--([a-z]+)=(.*)$/); if (m) flags[m[1]] = m[2]; }

function ask(question, hidden) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(question); };   // hide what is typed
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  try {
    console.log('\nCreate a SafeZone admin account\n');
    const name = v.cleanName(flags.name || await ask('Full name: '));
    const username = v.normUsername(flags.username || await ask('Username (3-20 letters, numbers, . - _): '));
    const email = v.normEmail(flags.email || await ask('PUP web mail (name@pup.edu.ph): '));
    const phone = v.normPhone(flags.phone || await ask('Mobile number (09XXXXXXXXX): '));
    const password = flags.password || await ask('Password (typing is hidden): ', true);

    if (name.length < 2) throw new Error('Enter a full name.');
    if (!v.validUsername(username)) throw new Error('Username: 3 to 20 letters, numbers, dots, dashes or underscores.');
    const kind = v.emailKind(email);
    if (!kind) throw new Error('Use a PUP web mail: @iskolarngbayan.pup.edu.ph or @pup.edu.ph.');
    if (!v.validPhone(phone)) throw new Error('Enter a valid Philippine mobile number, like 09XXXXXXXXX.');
    const problem = v.passwordProblem(password);
    if (problem) throw new Error(problem);

    await createUser({ role: 'admin', username, fullName: name, email, kind, phone, passwordHash: await bcrypt.hash(password, 10) });
    console.log(`\nDone. Admin "${username}" was created. Log in to the app with that username and your password.\n`);
  } catch (e) {
    console.log('\nNot created: ' + e.message + '\n');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
