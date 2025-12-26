const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT,
});

// The pool will emit an error on behalf of any idle client
// it contains if it closes unexpectedly (e.g., network issue, db restart).
// Adding this handler prevents the process from crashing.
pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    // Don't exit process, just log. The pool will discard the bad client.
});

module.exports = pool;
