const pool = require('./src/config/db');
async function check() {
  const res = await pool.query("SELECT * FROM user_addresses LIMIT 1");
  if (res.rows[0]) {
    for (const k of Object.keys(res.rows[0])) console.log('ADDR_COL: ' + k);
  } else {
    console.log('No address rows found');
  }
  const u = await pool.query("SELECT * FROM users LIMIT 1");
  if (u.rows[0]) {
    for (const k of Object.keys(u.rows[0])) console.log('USER_COL: ' + k);
  }
  process.exit();
}
check();
