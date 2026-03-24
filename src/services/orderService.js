const pool = require('../config/db');
const couponService = require('./couponService');

exports.createOrder = async (orderData) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const {
            userId, orderNumber, addressId, paymentMethod, paymentStatus, paymentType,
            subtotal, shipping, total, items, trackingNumber, estimatedDelivery,
            couponCode,   // optional — sent from Checkout.tsx when user applied a coupon
            cartItemIds
        } = orderData;
        console.log(`[OrderService] Starting order creation for user: ${userId}, Order #: ${orderNumber}`);
        console.log(`[OrderService] Order items count: ${items?.length}, Cart item IDs: ${JSON.stringify(cartItemIds)}`);
        // subtotal from client is received but intentionally never used in computation — dbSubtotal below is used instead

        // ── PRE-STEP: Always re-fetch real prices from DB ──────────────────────
        // This ensures scope matching AND subtotal calculations use authoritative
        // product prices — not values the client could have tampered with.

        let cartQuery = `SELECT
                ci.product_id,
                ci.product_id AS id,
                ci.quantity,
                p.price,
                p.category_id,
                p.brand   AS brand_id
             FROM cart_items ci
             JOIN products p ON ci.product_id::text = p.product_id::text
             WHERE ci.user_id = $1`;
        let cartParams = [userId];

        if (cartItemIds && cartItemIds.length > 0) {
            cartQuery += ` AND ci.product_id::integer = ANY($2::integer[])`;
            cartParams.push(cartItemIds);
        }

        const cartResult = await client.query(cartQuery, cartParams);
        console.log(`[OrderService] Cart fetch result: ${cartResult.rows.length} rows`);
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
        console.log(`[OrderService] DB Subtotal computed: ${dbSubtotal}`);

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
                user_id, order_number, address_id, payment_method, payment_status, payment_type,
                subtotal, original_total, shipping,
                discount_amount, total,
                coupon_code, coupon_id,
                status, tracking_number, estimated_delivery, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Pending', $14, $15, NOW(), NOW())
            RETURNING *`,
            [
                userId,                          // $1
                orderNumber,                     // $2
                addressId,                       // $3
                paymentMethod,                   // $4
                paymentStatus || 'Pending',      // $5
                paymentType || (paymentMethod === 'cod' ? 'COD' : 'Paid'), // $6
                dbSubtotal,                      // $7  — server-computed cart sum, never client value
                originalTotal,                   // $8  — pre-discount total (dbSubtotal + shipping)
                shipping || 0,                   // $9
                discountAmount,                  // $10 — 0 if no coupon
                finalTotal,                      // $11 — server-computed, never from client
                validatedCouponCode || null,     // $12 — normalized code string (kept for history)
                couponId,                        // $13 — FK → coupons.id; null if no coupon
                trackingNumber,                  // $14
                estimatedDelivery                // $15
            ]
        );

        const order = orderResult.rows[0];
        console.log(`[OrderService] Order inserted successfully: ID ${order.id}`);

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
                 WHERE product_id = $1::integer
                 RETURNING stock_quantity`,
                [item.id || item.productId, item.quantity]
            );

            if (stockUpdateResult.rows[0]?.stock_quantity === 0) {
                await client.query(
                    `UPDATE products SET instock = false WHERE product_id = $1::integer`,
                    [item.id || item.productId]
                );
            }
        }

        // ── STEP 5: Clear cart ─────────────────────────────────────────────────
        if (cartItemIds && cartItemIds.length > 0) {
            await client.query(`DELETE FROM cart_items WHERE user_id = $1 AND product_id::integer = ANY($2::integer[])`, [userId, cartItemIds]);
        } else {
            await client.query(`DELETE FROM cart_items WHERE user_id = $1`, [userId]);
        }

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

exports.getAllOrders = async (options = {}) => {
    const { limit = 10, offset = 0, status, paymentStatus } = options;

    let baseQuery = `FROM orders o LEFT JOIN user_addresses a ON o.address_id = a.id LEFT JOIN users u ON o.user_id = u.username WHERE 1=1`;
    const { type = 'successful' } = options;

    if (type === 'successful') {
        baseQuery += ` AND (o.payment_method = 'cod' OR o.payment_status != 'Pending')`;
    } else if (type === 'potential') {
        baseQuery += ` AND (o.payment_method != 'cod' AND o.payment_status = 'Pending')`;
    }
    // 'all' includes both successful and potential (DRAFTs/ABANDONED)

    const params = [];
    let paramIndex = 1;

    if (status && status !== 'all') {
        if (status === 'Cancelled') {
            baseQuery += ` AND o.status IN ('Cancelled', 'Returned', 'Refunded')`;
        } else {
            baseQuery += ` AND o.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
    }

    if (paymentStatus && paymentStatus !== 'all') {
        baseQuery += ` AND o.payment_status = $${paramIndex}`;
        params.push(paymentStatus);
        paramIndex++;
    }

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const totalCount = parseInt(countResult.rows[0].count);

    const queryParams = [...params, limit, offset];

    const orderResult = await pool.query(
        `SELECT o.*, u.emailid as customer_email, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default,
                COALESCE(
                    (SELECT json_agg(items_data)
                     FROM (
                         SELECT * FROM order_items WHERE order_id = o.id
                         ORDER BY created_at ASC
                     ) items_data
                    ), '[]'
                ) as items
         ${baseQuery}
         ORDER BY o.created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        queryParams
    );

    return {
        orders: orderResult.rows,
        totalCount: totalCount,
        limit,
        offset
    };
};

exports.getOrdersByUser = async (userId) => {
    // Use json_agg to avoid N+1 query problem and improve performance
    const orderResult = await pool.query(
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
         WHERE o.user_id = $1 
         ORDER BY o.created_at DESC`,
        [userId]
    );

    return orderResult.rows;
};

exports.getOrderById = async (orderId) => {
    const orderResult = await pool.query(
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
         WHERE o.id = $1`,
        [orderId]
    );

    if (orderResult.rows.length === 0) return null;

    return orderResult.rows[0];
};

exports.getOrderStats = async () => {
    // Metric logic:
    // Successful = COD (any status) OR Non-COD with payment processed (Paid/Completed)
    // Potential = Non-COD with payment NOT processed (Pending) — basically abandoned session
    const result = await pool.query(
        `SELECT 
            COUNT(*) FILTER (WHERE payment_method = 'cod' OR payment_status != 'Pending') as total,
            COUNT(*) FILTER (WHERE payment_method != 'cod' AND payment_status = 'Pending') as potential_users,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status != 'Pending') AND status NOT IN ('Cancelled', 'Returned', 'Refunded')) as active,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status != 'Pending') AND status = 'Pending') as pending,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status != 'Pending') AND status = 'Processing') as processing,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status != 'Pending') AND status = 'Delivered') as delivered,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status != 'Pending') AND status IN ('Cancelled', 'Returned', 'Refunded')) as canceled,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status != 'Pending') AND payment_status = 'Pending') as pending_payment
         FROM orders`
    );

    const stats = result.rows[0];
    return {
        total: parseInt(stats.total),
        potentialUsers: parseInt(stats.potential_users),
        active: parseInt(stats.active),
        pending: parseInt(stats.pending),
        processing: parseInt(stats.processing),
        delivered: parseInt(stats.delivered),
        canceled: parseInt(stats.canceled),
        pendingPayment: parseInt(stats.pending_payment),
        allRecordsCount: parseInt(stats.total) + parseInt(stats.potential_users) // total rows in DB
    };
};

exports.updateOrderStatus = async (orderId, status, cancelReason = null) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get current status to check for cancellation
        const currentOrderRes = await client.query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
        if (currentOrderRes.rows.length === 0) throw new Error('Order not found');

        const oldStatus = currentOrderRes.rows[0].status;

        // Update status
        let updateQuery;
        let updateParams;

        if (status === 'Cancelled') {
            updateQuery = `UPDATE orders SET status = $2, cancel_reason = $3, original_status = COALESCE(original_status, $4), cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`;
            updateParams = [orderId, status, cancelReason || 'Admin Action', oldStatus];
        } else if (status === 'Delivered' && oldStatus !== 'Delivered') {
            updateQuery = `UPDATE orders SET status = $2, delivered_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`;
            updateParams = [orderId, status];
        } else {
            updateQuery = `UPDATE orders SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`;
            updateParams = [orderId, status];
        }

        const updateResult = await client.query(updateQuery, updateParams);

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
                     WHERE product_id = $1::integer
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

exports.reorderOrder = async (orderId, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch order items and current product stock/price
        const orderItemsResult = await client.query(
            `SELECT oi.product_id, oi.quantity as order_quantity, p.stock_quantity, p.instock, p.productname as name 
             FROM order_items oi
             JOIN products p ON oi.product_id::text = p.product_id::text
             WHERE oi.order_id = $1`,
            [orderId]
        );

        if (orderItemsResult.rows.length === 0) {
            throw new Error('Order not found or has no items');
        }

        const items = orderItemsResult.rows;
        let addedCount = 0;
        let failedCount = 0;
        const failedItems = [];
        const addedProductIds = [];

        // 2. Add each available item to cart
        for (const item of items) {
            console.log(`[ReorderService] Processing item ${item.product_id} with status: ${item.instock}, stock: ${item.stock_quantity}`);
            if (item.instock && item.stock_quantity > 0) {
                // Requirement: Standardize Reorder Quantity to Single Unit (1)
                // Also: Reset quantity to 1 if already in cart (Option B)
                // Use ::integer casts to ensure conflict matching works regardless of parameter types
                await client.query(
                    `INSERT INTO cart_items (user_id, product_id, quantity, updated_at)
                     VALUES ($1, $2::integer, 1, NOW())
                     ON CONFLICT (user_id, product_id)
                     DO UPDATE SET 
                        quantity = 1, 
                        updated_at = NOW()`,
                    [userId, item.product_id]
                );
                addedCount++;
                addedProductIds.push(String(item.product_id));
            } else {
                failedCount++;
                failedItems.push(item.name);
            }
        }

        await client.query('COMMIT');
        
        return {
            success: true,
            added: addedCount,
            failed: failedCount,
            failedItems: failedItems,
            addedProductIds: addedProductIds
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
