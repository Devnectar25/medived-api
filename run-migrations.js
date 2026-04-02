const pool = require('./src/config/db');
const fs = require('fs');
const path = require('path');

const runMigrations = async () => {
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).sort();
    
    for (const file of files) {
        if (file.endsWith('.sql')) {
            console.log(`Running migration: ${file}`);
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            try {
                await pool.query(sql);
                console.log(`Successfully completed: ${file}`);
            } catch (err) {
                console.error(`Error running migration ${file}:`, err.message);
                // Continue if columns already exist
            }
        }
    }
    process.exit(0);
};

runMigrations();
