require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./src/config/db');

async function runMigration() {
    const client = await pool.connect();
    try {
        console.log('Running analytics events migration...');
        const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'create_analytics_events_table.sql'), 'utf8');
        await client.query(sql);
        console.log('✅ Analytics events table created successfully.');
    } catch (err) {
        console.error('❌ Migration failed:', err);
    } finally {
        client.release();
        pool.end();
    }
}

runMigration();
