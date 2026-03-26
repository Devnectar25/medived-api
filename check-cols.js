const pool = require('./src/config/db');
async function check() {
  const res = await pool.query("SELECT * FROM orders LIMIT 1");
  const cols = Object.keys(res.rows[0]);
  for(const c of cols) console.log('COL: ' + c);
  process.exit();
}
check();
