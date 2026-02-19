const pool = require('./src/config/db');

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('🚀 Starting Database Migration...');

        // Check columns in users table
        const res = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'users'
        `);

        const columns = res.rows.map(r => r.column_name);
        console.log('📊 Current columns:', columns.join(', '));

        const requiredColumns = [
            { name: 'google_id', type: 'VARCHAR(255)' },
            { name: 'facebook_id', type: 'VARCHAR(255)' },
            { name: 'avatar_url', type: 'TEXT' }
        ];

        for (const col of requiredColumns) {
            if (!columns.includes(col.name)) {
                console.log(`➕ Adding column: ${col.name}...`);
                await client.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
                console.log(`✅ Column ${col.name} added.`);
            } else {
                console.log(`ℹ️ Column ${col.name} already exists.`);
            }
        }

        console.log('✨ Migration completed successfully!');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
    } finally {
        client.release();
        process.exit();
    }
}

migrate();
