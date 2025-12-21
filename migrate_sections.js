const pool = require('./src/config/db');

async function migrate() {
    try {
        // Create table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sections (
                srno SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                image TEXT,
                active BOOLEAN DEFAULT true,
                createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Successfully created sections table');

        // Seed data
        const sections = [
            'Innovation should be fast, secure, and human-centered.',
            'What We Do',
            'Who We Serve',
            'Results We’ve Delivered',
            'Let’s Build What Your Team Really Needs'
        ];

        for (const title of sections) {
            const exists = await pool.query('SELECT * FROM sections WHERE title = $1', [title]);
            if (exists.rows.length === 0) {
                await pool.query('INSERT INTO sections (title) VALUES ($1)', [title]);
                console.log(`Seeded section: ${title}`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('Error in migration:', error);
        process.exit(1);
    }
}

migrate();
