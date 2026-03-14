const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
  port:     process.env.DB_PORT || process.env.MYSQLPORT || 3306,
  user:     process.env.DB_USER || process.env.MYSQLUSER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'fpl_analysis',
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
