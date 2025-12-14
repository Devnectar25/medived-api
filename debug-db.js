const pool = require('./src/config/db');

async function debugDb() {
    try {
        console.log("1. Testing Connection...");
        const res = await pool.query('SELECT NOW()');
        console.log("✅ Connection Successful:", res.rows[0]);

        console.log("2. Checking for 'brand' table...");
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'brand';
        `);

        if (tableCheck.rows.length > 0) {
            console.log("✅ Table 'brand' exists.");

            console.log("3. Fetching raw data from 'brand'...");
            const data = await pool.query('SELECT * FROM brand LIMIT 1');
            console.log("✅ Data sample:", data.rows);
        } else {
            console.log("❌ Table 'brand' DOES NOT EXIST.");
            console.log("Listing all tables in public schema:");
            const allTables = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public';
            `);
            console.log(allTables.rows.map(r => r.table_name));
        }

    } catch (err) {
        console.error("❌ DB Error:", err);
    } finally {
        pool.end();
    }
}

debugDb();
