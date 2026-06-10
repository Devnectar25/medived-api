const { Pool } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  const client = pool; // use default pool query
  try {
    console.log('Fetching all orders...');
    const ordersRes = await client.query('SELECT id, order_number, status, subtotal, total, shipping, discount_amount FROM orders');
    console.log(`Found ${ordersRes.rows.length} orders.`);

    let updatedCount = 0;
    const returnCancelStatuses = ['Cancelled', 'Return Approved', 'Return Processing', 'Return Collected', 'Received at Homved', 'Returned', 'Refunded', 'Restocked'];

    for (const order of ordersRes.rows) {
      const { id: orderId, order_number: orderNumber, shipping, discount_amount } = order;

      const subtotalResult = await client.query(
        `SELECT COALESCE(SUM(price * quantity), 0) as new_subtotal 
         FROM order_items 
         WHERE order_id = $1 
           AND (status IS NULL OR status NOT IN (${returnCancelStatuses.map((_, i) => `$${i + 2}`).join(', ')}))`,
        [orderId, ...returnCancelStatuses]
      );
      const newSubtotal = parseFloat(subtotalResult.rows[0].new_subtotal || 0);

      const oldSubtotal = parseFloat(order.subtotal || 0);
      const newTotal = Math.max(0, newSubtotal + parseFloat(shipping || 0) - parseFloat(discount_amount || 0));
      const oldTotal = parseFloat(order.total || 0);

      if (Math.abs(newSubtotal - oldSubtotal) > 0.01 || Math.abs(newTotal - oldTotal) > 0.01) {
        console.log(`Order ${orderNumber}: Subtotal ${oldSubtotal} -> ${newSubtotal}, Total ${oldTotal} -> ${newTotal}`);
        await client.query(
          `UPDATE orders 
           SET subtotal = $2::numeric,
               total = $3::numeric,
               updated_at = NOW()
           WHERE id = $1`,
          [orderId, newSubtotal, newTotal]
        );
        updatedCount++;
      }
    }
    console.log(`Recalculation complete. Updated ${updatedCount} orders.`);
  } catch (err) {
    console.error('Error during recalculation:', err);
  } finally {
    await pool.end();
  }
}

fix();
