const pool = require('../config/db');

exports.createOrder = async (orderData) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const {
            userId, orderNumber, addressId, paymentMethod, paymentStatus, paymentType,
            subtotal, shipping, total, items, trackingNumber, estimatedDelivery
        } = orderData;

        // 1. Create Order
        const orderResult = await client.query(
            `INSERT INTO orders (
                user_id, order_number, address_id, payment_method, payment_status, payment_type,
                subtotal, shipping, total, status, tracking_number, estimated_delivery, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $11, $6, $7, $8, 'Pending', $9, $10, NOW(), NOW())
            RETURNING *`,
            [userId, orderNumber, addressId, paymentMethod, paymentStatus || 'Pending', subtotal, shipping, total, trackingNumber, estimatedDelivery, paymentType || (paymentMethod === 'cod' ? 'COD' : 'Paid')]
        );

        const order = orderResult.rows[0];

        // 2. Create Order Items and Update Stock
        for (const item of items) {
            // Add item
            await client.query(
                `INSERT INTO order_items (order_id, product_id, name, price, quantity, image, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [order.id, item.id || item.productId, item.name, item.price, item.quantity, item.image]
            );

            // Update Stock
            // Decrement stock_quantity and quantity (syncing both for now)
            const stockUpdateResult = await client.query(
                `UPDATE products 
                 SET stock_quantity = GREATEST(0, stock_quantity - $2),
                     quantity = GREATEST(0, quantity - $2),
                     updated_at = NOW()
                 WHERE product_id = $1
                 RETURNING stock_quantity`,
                [item.id || item.productId, item.quantity]
            );

            // If stock becomes 0, mark as out of stock
            if (stockUpdateResult.rows[0]?.stock_quantity === 0) {
                await client.query(
                    `UPDATE products SET instock = false WHERE product_id = $1`,
                    [item.id || item.productId]
                );
            }
        }

        // 3. Clear Cart (since order is placed)
        await client.query(`DELETE FROM cart_items WHERE user_id = $1`, [userId]);

        await client.query('COMMIT');
        order.items = items;
        return order;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.getAllOrders = async () => {
    // Hide online orders that are still pending payment (not yet successful)
    const orderResult = await pool.query(
        `SELECT o.*, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default 
         FROM orders o
         LEFT JOIN user_addresses a ON o.address_id = a.id
         WHERE o.payment_method = 'cod' OR o.payment_status != 'Pending'
         ORDER BY o.created_at DESC`
    );

    const orders = orderResult.rows;
    for (const order of orders) {
        const itemsResult = await pool.query(
            `SELECT * FROM order_items WHERE order_id = $1`,
            [order.id]
        );
        order.items = itemsResult.rows;
    }

    return orders;
};

exports.getOrdersByUser = async (userId) => {
    const orderResult = await pool.query(
        `SELECT o.*, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default 
         FROM orders o
         LEFT JOIN user_addresses a ON o.address_id = a.id
         WHERE o.user_id = $1 
         ORDER BY o.created_at DESC`,
        [userId]
    );

    const orders = orderResult.rows;
    for (const order of orders) {
        const itemsResult = await pool.query(
            `SELECT * FROM order_items WHERE order_id = $1`,
            [order.id]
        );
        order.items = itemsResult.rows;
    }

    return orders;
};

exports.getOrderById = async (orderId) => {
    const orderResult = await pool.query(
        `SELECT o.*, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default 
         FROM orders o
         LEFT JOIN user_addresses a ON o.address_id = a.id
         WHERE o.id = $1`,
        [orderId]
    );

    if (orderResult.rows.length === 0) return null;

    const order = orderResult.rows[0];
    const itemsResult = await pool.query(
        `SELECT * FROM order_items WHERE order_id = $1`,
        [order.id]
    );
    order.items = itemsResult.rows;

    return order;
};

exports.updateOrderStatus = async (orderId, status) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get current status to check for cancellation
        const currentOrderRes = await client.query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
        if (currentOrderRes.rows.length === 0) throw new Error('Order not found');

        const oldStatus = currentOrderRes.rows[0].status;

        // Update status
        const updateResult = await client.query(
            `UPDATE orders SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [orderId, status]
        );

        const order = updateResult.rows[0];

        // If transitioning to Cancelled or Returned from a non-cancelled status, restore stock
        if (['Cancelled', 'Returned'].includes(status) && !['Cancelled', 'Returned'].includes(oldStatus)) {
            const itemsResult = await client.query(`SELECT product_id, quantity FROM order_items WHERE order_id = $1`, [orderId]);
            console.log(`[DEBUG] Restoring stock for order ${orderId}. Items count: ${itemsResult.rows.length}`);
            for (const item of itemsResult.rows) {
                console.log(`[DEBUG] Item ${item.product_id}: quantity ${item.quantity}`);
                const updateRes = await client.query(
                    `UPDATE products 
                     SET stock_quantity = stock_quantity + $2,
                         quantity = quantity + $2,
                         instock = true,
                         updated_at = NOW()
                     WHERE product_id = $1
                     RETURNING stock_quantity, quantity`,
                    [item.product_id, item.quantity]
                );
                // console.log(`[DEBUG] Updated product ${item.product_id}. New stock_quantity: ${updateRes.rows[0]?.stock_quantity}, quantity: ${updateRes.rows[0]?.quantity}`);
            }
        }

        await client.query('COMMIT');
        return order;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
