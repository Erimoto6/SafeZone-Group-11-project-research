// Run with:  npm run check-db
// Checks that the backend can reach MySQL, that the tables exist, and that an admin account exists.
require('dotenv').config({ quiet: true });
const { pool } = require('../src/db');

const EXPECTED = ['users', 'password_resets', 'rooms', 'thresholds', 'settings', 'sms_recipients',
  'alerts', 'notification_log', 'system_logs', 'device_status', 'reading_hourly', 'simulation_state'];

(async () => {
  try {
    const [[v]] = await pool.query('SELECT VERSION() AS version, DATABASE() AS db, CURRENT_USER() AS who');
    console.log(`\nConnected to MySQL ${v.version}`);
    console.log(`  database: ${v.db}    user: ${v.who}\n`);

    const [t] = await pool.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()');
    const have = t.map(r => String(r.name).toLowerCase());
    for (const n of EXPECTED) {
      if (have.includes(n)) {
        const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${n}\``);
        console.log(`  ok       ${n.padEnd(17)} ${c.n} row(s)`);
      } else {
        console.log(`  MISSING  ${n}`);
      }
    }
    if (EXPECTED.some(n => !have.includes(n))) {
      console.log('\nSome tables are missing. Run database/02-schema.sql and database/04-shared-simulations.sql (as root) and check again.');
      process.exitCode = 1;
      return;
    }
    const [[a]] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
    console.log(a.n ? `\nAll good. ${a.n} admin account(s) found.` : '\nAll good, but there is no admin account yet. Create one with:  npm run create-admin');
  } catch (e) {
    console.log('\nCould not use the database.');
    if (e.code === 'ECONNREFUSED') console.log(`MySQL is not answering at ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}. Is it running? In XAMPP, click Start next to MySQL.`);
    else if (e.code === 'ER_ACCESS_DENIED_ERROR') console.log('MySQL refused the user or password. Make DB_USER and DB_PASSWORD in .env match what you set in 01-create-database.sql.');
    else if (e.code === 'ER_BAD_DB_ERROR') console.log('The database "safezone" does not exist yet. Run database/01-create-database.sql first.');
    else console.log(e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
