const pool = require('./src/config/db');
async function run() {
  const res = await pool.query("SELECT id, status, payment_status, payment_method FROM orders LIMIT 50");
  for(const r of res.rows) console.log(JSON.stringify(r));
  process.exit();
}
run();
