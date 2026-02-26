const pool = require('../config/db');
const couponService = require('./couponService');

exports.createOrder = async (orderData) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const {
            userId, orderNumber, addressId, paymentMethod, paymentStatus,
            subtotal, shipping, items, trackingNumber, estimatedDelivery,
            couponCode   // optional — sent from Checkout.tsx when user applied a coupon
        } = orderData;
        // subtotal from client is received but intentionally never used in computation — dbSubtotal below is used instead

        // ── PRE-STEP: Always re-fetch real prices from DB ──────────────────────
        // This ensures scope matching AND subtotal calculations use authoritative
        // product prices — not values the client could have tampered with.
        const cartResult = await client.query(
            `SELECT
                ci.product_id,
                ci.product_id AS id,
                ci.quantity,
                p.price,
                p.category_id,
                p.brand   AS brand_id
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.product_id
             WHERE ci.user_id = $1`,
            [userId]
        );
        const dbCartItems = cartResult.rows.map(row => ({
            ...row,
            price: parseFloat(row.price),
            quantity: parseInt(row.quantity, 10)
        }));

        // Compute subtotal from DB cart prices — client value is ignored
        const dbSubtotal = dbCartItems.reduce(
            (sum, item) => sum + (item.price * item.quantity),
            0
        );

        // ── STEP 1: Coupon validation (server-side, inside transaction) ────────
        // We never trust the client's `total`. We always recompute here.
        let discountAmount = 0;
        let couponId = null;                // FK → coupons.id; null if no coupon applied
        let validatedCouponCode = null;
        // originalTotal = pre-discount total (dbSubtotal + shipping); used for audit clarity
        const originalTotal = dbSubtotal + parseFloat(shipping || 0);
        let finalTotal = originalTotal;

        if (couponCode) {
            // dbCartItems already fetched above from DB — real prices, not client values.
            // validateCoupon: checks active, expiry, min_order_value (vs dbSubtotal),
            //                 usage_limit, assignment eligibility, scope matching.
            const validation = await couponService.validateCoupon(
                couponCode,
                dbSubtotal,             // server-computed from DB prices, never client value
                dbCartItems,
                userId
            );

            discountAmount = validation.discountAmount;
            couponId = validation.coupon?.id || null;      // FK — links order to coupons row
            validatedCouponCode = validation.coupon.code;  // normalized uppercase from service
            finalTotal = originalTotal - discountAmount;   // originalTotal already = dbSubtotal + shipping

            if (finalTotal < 0) finalTotal = 0;
        }

        // ── STEP 2: Insert order with coupon fields ────────────────────────────
        const orderResult = await client.query(
            `INSERT INTO orders (
                user_id, order_number, address_id, payment_method, payment_status,
                subtotal, original_total, shipping,
                discount_amount, total,
                coupon_code, coupon_id,
                status, tracking_number, estimated_delivery, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Processing', $13, $14, NOW(), NOW())
            RETURNING *`,
            [
                userId,                          // $1
                orderNumber,                     // $2
                addressId,                       // $3
                paymentMethod,                   // $4
                paymentStatus || 'Pending',      // $5
                dbSubtotal,                      // $6  — server-computed cart sum, never client value
                originalTotal,                   // $7  — pre-discount total (dbSubtotal + shipping)
                shipping || 0,                   // $8
                discountAmount,                  // $9  — 0 if no coupon
                finalTotal,                      // $10 — server-computed, never from client
                validatedCouponCode || null,      // $11 — normalized code string (kept for history)
                couponId,                        // $12 — FK → coupons.id; null if no coupon
                trackingNumber,                  // $13
                estimatedDelivery                // $14
            ]
        );

        const order = orderResult.rows[0];

        // ── STEP 3: Mark coupon assignment as used ─────────────────────────────
        // Only runs if a valid coupon was applied. Silently skips if the coupon
        // was global (no assignment row exists) — that is expected and correct.
        if (validatedCouponCode) {
            await client.query(
                `UPDATE coupon_assignments
                 SET status  = 'used',
                     used_at = NOW()
                 WHERE coupon_id = (SELECT id FROM coupons WHERE code = $1)
                   AND user_id   = $2
                   AND status    = 'assigned'`,
                [validatedCouponCode, userId]
            );
        }

        // ── STEP 4: Insert order items + update stock ──────────────────────────
        for (const item of items) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, name, price, quantity, image, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [order.id, item.id || item.productId, item.name, item.price, item.quantity, item.image]
            );

            const stockUpdateResult = await client.query(
                `UPDATE products
                 SET stock_quantity = GREATEST(0, stock_quantity - $2),
                     quantity       = GREATEST(0, quantity - $2),
                     updated_at     = NOW()
                 WHERE product_id = $1
                 RETURNING stock_quantity`,
                [item.id || item.productId, item.quantity]
            );

            if (stockUpdateResult.rows[0]?.stock_quantity === 0) {
                await client.query(
                    `UPDATE products SET instock = false WHERE product_id = $1`,
                    [item.id || item.productId]
                );
            }
        }

        // ── STEP 5: Clear cart ─────────────────────────────────────────────────
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
    const orderResult = await pool.query(
        `SELECT * FROM orders ORDER BY created_at DESC`
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
        `SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
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
