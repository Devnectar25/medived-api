const pool = require('./src/config/db');

async function fixDb() {
    try {
        console.log('Altering image_url column to TEXT...');
        await pool.query('ALTER TABLE whatsapp_campaigns ALTER COLUMN image_url TYPE TEXT;');
        console.log('Success! Table altered.');
    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit(0);
    }
}

fixDb();
