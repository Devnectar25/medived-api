const pool = require('./src/config/db');
async function test() {
   const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'");
   console.log(res.rows);
   const pk = await pool.query(`SELECT kcu.column_name
    FROM information_schema.table_constraints tco
    JOIN information_schema.key_column_usage kcu 
      ON kcu.constraint_name = tco.constraint_name
      AND kcu.constraint_schema = tco.constraint_schema
      AND kcu.constraint_name = tco.constraint_name
    WHERE tco.constraint_type = 'PRIMARY KEY'
      AND kcu.table_name = 'users'`);
   console.log('PK:', pk.rows);
   pool.end();
}
test();
