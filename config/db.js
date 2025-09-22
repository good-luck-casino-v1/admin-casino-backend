const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '134.209.148.93',
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'Admin#Casino2025!',
  database: process.env.DB_NAME || 'good_luck_casino',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;