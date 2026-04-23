const pool = require('../src/config/db');

async function analyze() {
    try {
        const res = await pool.query('SELECT id, title, festival_message, offer_details FROM whatsapp_campaigns');
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

analyze();
