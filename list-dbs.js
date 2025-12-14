const pool = require('./src/config/db');

async function listDbs() {
    try {
        const res = await pool.query('SELECT datname FROM pg_database WHERE datistemplate = false;');
        console.log("Databases found:", res.rows.map(r => r.datname));
    } catch (err) {
        console.error("Error listing DBs:", err);
    } finally {
        pool.end();
    }
}

listDbs();
