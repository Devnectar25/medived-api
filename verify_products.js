const pool = require('./src/config/db');
async function test() {
   const pk = await pool.query(`SELECT kcu.column_name, data_type
    FROM information_schema.table_constraints tco
    JOIN information_schema.key_column_usage kcu 
      ON kcu.constraint_name = tco.constraint_name
      AND kcu.constraint_schema = tco.constraint_schema
      AND kcu.constraint_name = tco.constraint_name
    JOIN information_schema.columns c
      ON c.table_name = kcu.table_name AND c.column_name = kcu.column_name
    WHERE tco.constraint_type = 'PRIMARY KEY'
      AND kcu.table_name = 'products'`);
   console.log('PRODUCTS PK:', pk.rows);
   pool.end();
}
test();
