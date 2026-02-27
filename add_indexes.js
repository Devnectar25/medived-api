const pool = require('./src/config/db');

async function addIndexes() {
    try {
        console.log('Adding indexes...');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)');
        console.log('Indexes added successfully.');
    } catch (error) {
        console.error('Error adding indexes:', error);
    } finally {
        await pool.end();
    }
}

addIndexes();
