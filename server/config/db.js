const mysql = require('mysql2/promise');

const connectionUri =
  process.env.DATABASE_URL ||
  process.env.MYSQL_URL ||
  process.env.MYSQL_URI ||
  process.env.MYSQL_PUBLIC_URL;

const pool = mysql.createPool(
  connectionUri || {
    host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
    port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
    user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'fpl_analysis',
    waitForConnections: true,
    connectionLimit: 10,
  }
);

module.exports = pool;
