// One shared connection pool to MySQL. Every query uses "?" placeholders, never string joining,
// so people cannot sneak SQL in through the app (SQL injection).
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'safezone_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'safezone',
  socketPath: process.env.DB_SOCKET || undefined,   // only used for local testing
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  decimalNumbers: true          // DECIMAL columns come back as numbers, not text
});

module.exports = { pool };
