require('dotenv').config();
const pool = require('./src/config/db.js');

async function audit() {
    try {
        const res = await pool.query(`
            SELECT payment_method, payment_status, COUNT(*) as count 
            FROM orders 
            GROUP BY payment_method, payment_status
        `);
        console.log(JSON.stringify(res.rows, null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

audit();
