const pool = require('../config/db');
const fs = require('fs');

async function debug() {
    try {
        console.log('--- DEBUG START ---');

        // 1. Connection check
        const res = await pool.query('SELECT NOW()');
        console.log('Connected:', res.rows[0]);

        // 2. List columns of users
        const cols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'users'
            ORDER BY column_name
        `);

        const columnList = cols.rows.map(c => `${c.column_name} (${c.data_type})`);
        fs.writeFileSync('db_columns.txt', columnList.join('\n'));
        console.log('Columns written to db_columns.txt');

        process.exit(0);
    } catch (err) {
        console.error('DEBUG ERROR:', err);
        process.exit(1);
    }
}

debug();
