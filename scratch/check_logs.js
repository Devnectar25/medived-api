const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT,
    ssl: { rejectUnauthorized: false },
});

async function checkLogs() {
    try {
        console.log('Checking latest 5 chatbot queries...');
        const result = await pool.query(`
            SELECT id, user_query, response, intent, was_successful, created_at 
            FROM chatbot_query_logs 
            ORDER BY id DESC 
            LIMIT 5
        `);
        
        result.rows.forEach(r => {
            console.log('---');
            console.log('ID:', r.id);
            console.log('Query:', r.user_query);
            console.log('Response:', r.response);
            console.log('Intent:', r.intent);
            console.log('Successful:', r.was_successful);
            console.log('Date:', r.created_at);
        });
    } catch (err) {
        console.error('Error fetching logs:', err.message);
    } finally {
        await pool.end();
    }
}

checkLogs();
