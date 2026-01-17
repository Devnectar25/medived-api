const pool = require('../config/db');

async function migrate() {
    try {
        console.log('Starting migration: Adding member_since to public.users...');

        // 1. Check if column exists
        const checkColumn = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'users' 
            AND column_name = 'member_since';
        `);

        if (checkColumn.rows.length === 0) {
            console.log('Column member_since does not exist. Adding it...');
            await pool.query(`
                ALTER TABLE public.users 
                ADD COLUMN member_since TIMESTAMP DEFAULT NOW();
            `);
            console.log('Column added successfully.');

            // 2. Sync existing data from createdate if it exists
            const checkCreateDate = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'users' 
                AND column_name = 'createdate';
            `);

            if (checkCreateDate.rows.length > 0) {
                console.log('Syncing data from createdate to member_since...');
                await pool.query(`
                    UPDATE public.users 
                    SET member_since = createdate 
                    WHERE createdate IS NOT NULL;
                `);
                console.log('Data synced successfully.');
            }
        } else {
            console.log('Column member_since already exists.');
        }

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
