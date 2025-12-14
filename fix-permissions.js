const { Pool } = require('pg');

// Connect as the superuser (postgres) to grant permissions
const pool = new Pool({
    host: 'localhost',
    user: 'postgres',
    password: 'admin1234',
    database: 'homeveda',
    port: 5432,
});

async function grantPermissions() {
    try {
        console.log("Connecting as 'postgres' to grant permissions to 'sagar739'...");

        // Grant usage on schema
        await pool.query("GRANT USAGE ON SCHEMA public TO sagar739;");
        console.log("✅ Granted USAGE on public schema.");

        // Grant select/insert/update/delete on all tables
        await pool.query("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO sagar739;");
        console.log("✅ Granted ALL PRIVILEGES on all tables.");

        // Grant on future tables (optional but good)
        await pool.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO sagar739;");
        console.log("✅ Granted default privileges for future tables.");

    } catch (err) {
        console.error("❌ Error granting permissions:", err);
    } finally {
        pool.end();
    }
}

grantPermissions();
