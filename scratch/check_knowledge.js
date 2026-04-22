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

async function checkKnowledge() {
    try {
        console.log('Checking approved knowledge entries...');
        const result = await pool.query(`
            SELECT query_pattern, answer, intent FROM chatbot_knowledge 
            WHERE is_approved = true
            LIMIT 10
        `);
        console.table(result.rows);
    } catch (err) {
        console.error('Error fetching knowledge:', err.message);
    } finally {
        await pool.end();
    }
}

checkKnowledge();
