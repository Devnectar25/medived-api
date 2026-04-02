const pool = require('../src/config/db');

async function run() {
    try {
        console.log("Starting comprehensive schema sync...");

        // Columns for 'orders' table
        const orderCols = [
            { name: "is_returned_order", type: "BOOLEAN", def: "FALSE" },
            { name: "return_request_at", type: "TIMESTAMP WITH TIME ZONE", def: "NULL" },
            { name: "return_type", type: "TEXT", def: "NULL" },
            { name: "return_reason", type: "TEXT", def: "NULL" },
            { name: "return_images", type: "TEXT[]", def: "DEFAULT '{}'" },
            { name: "refund_eligible_amount", type: "NUMERIC(10,2)", def: "0" },
            { name: "cancel_reason", type: "TEXT", def: "NULL" },
            { name: "rejection_reason", type: "TEXT", def: "NULL" },
            { name: "refund_bank_account", type: "TEXT", def: "NULL" },
            { name: "refund_ifsc_code", type: "TEXT", def: "NULL" },
            { name: "refund_holder_name", type: "TEXT", def: "NULL" }
        ];

        for (const col of orderCols) {
            const res = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = $1`, [col.name]);
            if (res.rows.length === 0) {
                console.log(`Adding ${col.name} to orders...`);
                await pool.query(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.type} ${col.def}`);
            }
        }

        // Columns for 'order_items' table
        const itemCols = [
            { name: "cancel_reason", type: "TEXT", def: "NULL" },
            { name: "return_reason", type: "TEXT", def: "NULL" },
            { name: "status", type: "TEXT", def: "NULL" }
        ];

        for (const col of itemCols) {
            const res = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = $1`, [col.name]);
            if (res.rows.length === 0) {
                console.log(`Adding ${col.name} to order_items...`);
                await pool.query(`ALTER TABLE order_items ADD COLUMN ${col.name} ${col.type} ${col.def}`);
            }
        }

        console.log("✅ Comprehensive schema sync completed!");
    } catch (err) {
        console.error("❌ Migration failed:", err);
    } finally {
        process.exit();
    }
}

run();
