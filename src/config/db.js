const { Pool } = require('pg');
require('dotenv').config({ override: true });


const pool = new Pool({
    connectionString: `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`,
    ssl: {
        rejectUnauthorized: false
    }
});

// The pool will emit an error on behalf of any idle client
// it contains if it closes unexpectedly (e.g., network issue, db restart).
// Adding this handler prevents the process from crashing.
pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    // Don't exit process, just log. The pool will discard the bad client.
});

module.exports = pool;
