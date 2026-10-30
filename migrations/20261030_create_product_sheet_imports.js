const path = require('path');
const beRoot = 'c:/workspace/HomVed-Latest/HomVed-BE';
require(beRoot + '/node_modules/dotenv').config({ path: beRoot + '/.env' });
const pool = require(beRoot + '/src/config/db');

async function migrate() {
    try {
        console.log("Creating product_sheet_imports table...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.product_sheet_imports (
                id SERIAL PRIMARY KEY,
                sheet_name VARCHAR(255) NOT NULL,
                file_name VARCHAR(255),
                total_products INTEGER DEFAULT 0,
                imported_count INTEGER DEFAULT 0,
                updated_count INTEGER DEFAULT 0,
                product_ids INTEGER[] DEFAULT '{}',
                status VARCHAR(50) DEFAULT 'completed',
                uploaded_at TIMESTAMPTZ DEFAULT NOW(),
                created_by VARCHAR(100) DEFAULT 'Admin'
            );
        `);
        console.log("Table product_sheet_imports created or already exists.");

        // Check if today's 441 products exist and link them
        const todayRes = await pool.query(`
            SELECT product_id, productname 
            FROM products 
            WHERE createdate >= '2026-10-30 00:00:00'
            ORDER BY product_id ASC;
        `);

        if (todayRes.rows.length > 0) {
            const countCheck = await pool.query("SELECT COUNT(*) FROM product_sheet_imports");
            if (parseInt(countCheck.rows[0].count) === 0) {
                const productIds = todayRes.rows.map(r => r.product_id);
                console.log(`Linking existing ${productIds.length} products to initial sheet history...`);
                await pool.query(`
                    INSERT INTO product_sheet_imports 
                    (sheet_name, file_name, total_products, imported_count, updated_count, product_ids, status, uploaded_at)
                    VALUES ($1, $2, $3, $4, 0, $5, 'completed', NOW())
                `, [
                    'Product sheet',
                    'Homved_Product_Sheet_Ekart.xlsx',
                    productIds.length,
                    productIds.length,
                    productIds
                ]);
                console.log("Initial history record created successfully!");
            }
        }

        const res = await pool.query("SELECT * FROM product_sheet_imports");
        console.log("Current sheet imports history:", res.rows);

    } catch (err) {
        console.error("Migration error:", err);
    } finally {
        await pool.end();
    }
}

migrate();

