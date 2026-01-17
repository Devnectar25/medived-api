const pool = require('../config/db');

async function createTable() {
    try {
        console.log('Starting migration: Creating public.user_addresses table...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.user_addresses (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) REFERENCES public.users(username) ON DELETE CASCADE,
                address_label VARCHAR(50) NOT NULL, -- e.g., 'Home', 'Office'
                full_address TEXT NOT NULL,
                city VARCHAR(100) NOT NULL,
                state VARCHAR(100) NOT NULL,
                postal_code VARCHAR(20) NOT NULL,
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        console.log('Table user_addresses created or already exists.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

createTable();
