const pool = require('./src/config/db');

async function benchmark() {
    const start = Date.now();
    try {
        console.log('Running optimized query...');
        const result = await pool.query(
            `SELECT o.*, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default,
                    COALESCE(
                        (SELECT json_agg(items_data)
                         FROM (
                             SELECT * FROM order_items WHERE order_id = o.id
                             ORDER BY created_at ASC
                         ) items_data
                        ), '[]'
                    ) as items
             FROM orders o
             LEFT JOIN user_addresses a ON o.address_id = a.id
             WHERE o.payment_method = 'cod' OR o.payment_status != 'Pending'
             ORDER BY o.created_at DESC`
        );
        const end = Date.now();
        console.log(`Query took ${end - start}ms`);
        console.log(`Returned ${result.rows.length} rows`);
    } catch (error) {
        console.error('Error during benchmark:', error);
    } finally {
        await pool.end();
    }
}

benchmark();
