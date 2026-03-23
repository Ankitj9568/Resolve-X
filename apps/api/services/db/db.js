
const { Pool } = require('pg');
 
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                // max pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
 
pool.on('error', (err) => {
  console.error('Unexpected DB pool error', err);
});
 
module.exports = pool;
 