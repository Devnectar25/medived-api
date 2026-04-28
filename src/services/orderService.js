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
        if (status === 'Cancelled' || status === 'Cancellation Processing') {
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

    if (options.userName) {
        baseQuery += ` AND (u.username ILIKE $${paramIndex} OR u.emailid ILIKE $${paramIndex})`;
        params.push(`%${options.userName}%`);
        paramIndex++;
    }

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const totalCount = parseInt(countResult.rows[0].count);

    const queryParams = [...params, limit, offset];

    const orderResult = await pool.query(
        `SELECT o.*, u.emailid as customer_email, u.contactno as customer_phone, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default,
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

exports.getCancelledOrders = async (options = {}) => {
    const { limit = 10, offset = 0 } = options;

    const baseQuery = `FROM orders o 
                     LEFT JOIN users u ON o.user_id = u.username 
                     LEFT JOIN user_addresses a ON o.address_id = a.id 
                     WHERE (o.status IN ('CANCEL_REQUESTED', 'Cancelled', 'Refunded', 'Cancellation Processing', 'Returned', 'Received at Homved', 'Return Request Processing', 'Return Approved', 'Return Rejected'))
                     AND (LOWER(o.payment_method) != 'cod' OR o.status LIKE 'Return%' OR o.status IN ('Returned', 'Refunded'))`;

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`);
    const totalCount = parseInt(countResult.rows[0].count);

    const orderResult = await pool.query(
        `SELECT o.*, u.emailid as customer_email, u.contactno as customer_phone, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default,
                COALESCE(
                    (SELECT json_agg(items_data)
                     FROM (
                         SELECT * FROM order_items WHERE order_id = o.id
                         ORDER BY created_at ASC
                     ) items_data
                    ), '[]'
                ) as items,
                COALESCE(
                    (SELECT 
                        ROUND(
                            SUM(price * quantity) - 
                            ( (SUM(price * quantity) / NULLIF(o.subtotal, 0)) * COALESCE(o.discount_amount, 0) )
                        , 2)
                     FROM order_items 
                     WHERE order_id = o.id AND (status = 'Cancelled' OR status = 'Returned' OR status = 'Return Approved' OR status = 'Return Request Processing')
                    ), 0
                ) as refund_eligible_amount,
                COALESCE(
                    (SELECT json_agg(i_data)
                     FROM (
                         SELECT name, quantity, price, status FROM order_items 
                         WHERE order_id = o.id AND (status = 'Cancelled' OR status = 'Returned' OR status = 'Return Approved' OR status = 'Return Request Processing')
                     ) i_data
                    ), '[]'
                ) as refund_items
         ${baseQuery}
         ORDER BY o.updated_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
    );

    return {
        orders: orderResult.rows,
        totalCount: totalCount,
        limit,
        offset
    };
};

exports.getCancelledOrdersStats = async () => {
    const result = await pool.query(
        `SELECT 
            COUNT(*) FILTER (WHERE (status IN ('CANCEL_REQUESTED', 'Cancelled', 'Refunded', 'Cancellation Processing', 'Returned', 'Received at Homved')) AND LOWER(payment_method) != 'cod') as total_cancelled,
            COUNT(*) FILTER (WHERE refund_status = 'Pending' AND LOWER(payment_method) != 'cod') as pending_refunds
         FROM orders`
    );
    return result.rows[0];
};

exports.getOrdersByUser = async (userId) => {
    // Use json_agg to avoid N+1 query problem and improve performance
    const orderResult = await pool.query(
        `SELECT o.*, u.emailid as customer_email, u.contactno as customer_phone, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default,
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
         LEFT JOIN users u ON o.user_id = u.username
         WHERE o.user_id = $1 
         ORDER BY o.created_at DESC`,
        [userId]
    );

    return orderResult.rows;
};

exports.getOrderById = async (orderId) => {
    const orderResult = await pool.query(
        `SELECT o.*, u.emailid as customer_email, u.contactno as customer_phone, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default,
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
         LEFT JOIN users u ON o.user_id = u.username
         WHERE o.id = $1`,
        [orderId]
    );

    if (orderResult.rows.length === 0) return null;

    return orderResult.rows[0];
};

/**
 * HOMVED-RR-03: End-to-End Managed Return & Replacement Lifecycle
 * User-side Return/Replace request processing.
 */
exports.requestReturnReplace = async (orderId, userId, data) => {
    const { type, reason, bankDetails, images, items: requestedItems } = data;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch order to verify eligibility
        const orderRes = await client.query(
            `SELECT * FROM orders WHERE id = $1::uuid`,
            [orderId]
        );

        if (orderRes.rows.length === 0) throw new Error('Order not found');
        const order = orderRes.rows[0];

        // 2. Security & Eligibility Checks
        if (order.user_id !== userId) throw new Error('Not authorized to request return/replace for this order');

        const windowDays = 7;
        const deliveredDate = order.delivered_at ? new Date(order.delivered_at) : null;
        if (!deliveredDate && order.status === 'Delivered') throw new Error('Delivery timestamp missing.');
        
        if (deliveredDate) {
            const diffDays = Math.ceil(Math.abs(new Date() - deliveredDate) / (1000 * 60 * 60 * 24));
            if (diffDays > windowDays) throw new Error(`Return window expired (${windowDays} days)`);
        }

        // 3. Process each item individually (Row Splitting for partial quantities)
        const isReturn = type === 'Return';
        const itemStatus = isReturn ? 'Return Request Processing' : 'Replacement Request Processing';

        for (const reqItem of requestedItems) {
            const { id: itemId, quantity: returnQty } = reqItem;
            
            // Fetch current item state
            const itemRes = await client.query(`SELECT * FROM order_items WHERE id = $1::uuid AND order_id = $2::uuid`, [itemId, orderId]);
            if (itemRes.rows.length === 0) continue;
            const originalItem = itemRes.rows[0];

            if (returnQty > originalItem.quantity) throw new Error(`Cannot return more than purchased for ${originalItem.name}`);

            if (returnQty < originalItem.quantity) {
                // SPLIT ROW: Reduce original quantity
                await client.query(`UPDATE order_items SET quantity = quantity - $1 WHERE id = $2::uuid`, [returnQty, itemId]);
                
                // INSERT new row as requested for return/replace
                await client.query(
                    `INSERT INTO order_items (
                        order_id, product_id, name, quantity, price, image, status, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
                    [orderId, originalItem.product_id, originalItem.name, returnQty, originalItem.price, originalItem.image, itemStatus]
                );
            } else {
                // FULL ROW: Just update status
                await client.query(`UPDATE order_items SET status = $1 WHERE id = $2::uuid`, [itemStatus, itemId]);
            }
        }

        // 4. Update Main Order Status
        // If some items are being returned, mark order as "Partially Returning" for clarity
        const orderStatus = isReturn ? 'Return Request Processing' : 'Replacement Request Processing';
        
        await client.query(
            `UPDATE orders 
            SET status = $2::text,
                return_type = $3::text,
                return_reason = $4::text,
                return_images = $5::text[],
                return_request_at = NOW(),
                updated_at = NOW(),
                refund_bank_account = $6::text,
                refund_ifsc_code = $7::text,
                refund_holder_name = $8::text,
                is_returned_order = $9::boolean
            WHERE id = $1::uuid`,
            [
                orderId,
                orderStatus,
                type,
                reason,
                images || [],
                isReturn ? (bankDetails?.accountNumber || null) : order.refund_bank_account,
                isReturn ? (bankDetails?.ifscCode || null) : order.refund_ifsc_code,
                isReturn ? (bankDetails?.holderName || null) : order.refund_holder_name,
                isReturn
            ]
        );

        await client.query('COMMIT');
        return await exports.getOrderById(orderId);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
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

exports.updateOrderStatus = async (orderId, status, cancelReason = null, bankDetails = null, paymentStatus = null, itemIds = null) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get current status to check for cancellation
        const currentOrderRes = await client.query(`SELECT status, payment_method, is_product_received, payment_status, refund_status, logistics_status FROM orders WHERE id = $1`, [orderId]);
        if (currentOrderRes.rows.length === 0) throw new Error('Order not found');

        const oldOrder = currentOrderRes.rows[0];
        const oldStatus = oldOrder.status;
        const oldIsProductReceived = oldOrder.is_product_received;

        // --- PARTIAL CANCELLATION LOGIC ---
        // itemIds here is expected to be [{ id: item_id, quantity: cancel_qty }]
        if (itemIds && Array.isArray(itemIds) && itemIds.length > 0 && typeof itemIds[0] === 'object' && 
            (status === 'Cancelled' || status === 'Cancellation Processing' || status === 'CANCEL_REQUESTED')) {
            console.log(`[OrderService] Processing partial cancellation for order ${orderId}, items: ${JSON.stringify(itemIds)}`);
            
            for (const reqItem of itemIds) {
                const { id: itemId, quantity: cancelQty } = reqItem;
                
                // Fetch current item state
                const itemRes = await client.query(`SELECT * FROM order_items WHERE id = $1::uuid AND order_id = $2::uuid`, [itemId, orderId]);
                if (itemRes.rows.length === 0) continue;
                const originalItem = itemRes.rows[0];

                if (cancelQty > originalItem.quantity) throw new Error(`Cannot cancel more than purchased for ${originalItem.name}`);

                if (cancelQty < originalItem.quantity) {
                    // SPLIT ROW: Reduce original quantity
                    await client.query(`UPDATE order_items SET quantity = quantity - $1 WHERE id = $2::uuid`, [cancelQty, itemId]);
                    
                    // INSERT new row with the requested status
                    await client.query(
                        `INSERT INTO order_items (
                            order_id, product_id, name, quantity, price, image, status, cancel_reason, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                        [orderId, originalItem.product_id, originalItem.name, cancelQty, originalItem.price, originalItem.image, status, cancelReason || 'User Request']
                    );
                } else {
                    // FULL ROW: Just update status
                    await client.query(`UPDATE order_items SET status = $1, cancel_reason = $2 WHERE id = $3::uuid`, [status, cancelReason || 'User Request', itemId]);
                }

                // Restore stock for the cancelled quantity
                await client.query(
                    `UPDATE products 
                     SET stock_quantity = stock_quantity + $2,
                         quantity = quantity + $2,
                         instock = true,
                         updated_at = NOW()
                     WHERE product_id = $1::integer`,
                    [originalItem.product_id, cancelQty]
                );
            }

            // 3. Check if all items in the order are now cancelled
            const totalItemsResult = await client.query(`SELECT COUNT(*) FROM order_items WHERE order_id = $1`, [orderId]);
            const cancelledItemsResult = await client.query(`SELECT COUNT(*) FROM order_items WHERE order_id = $1 AND status = 'Cancelled'`, [orderId]);
            
            const totalCount = parseInt(totalItemsResult.rows[0].count);
            const cancelledCount = parseInt(cancelledItemsResult.rows[0].count);

            if (cancelledCount === totalCount) {
                // All items cancelled -> update main order to status
                status = 'Cancelled'; 
            } else {
                // Calculate new subtotal for remaining active items
                const subtotalResult = await client.query(
                    `SELECT SUM(price * quantity) as new_subtotal FROM order_items WHERE order_id = $1 AND (status IS NULL OR status != 'Cancelled')`,
                    [orderId]
                );
                const newSubtotal = parseFloat(subtotalResult.rows[0].new_subtotal || 0);

                // Calculate proportional refund: (Original Subtotal - New Subtotal)
                const refundValue = Math.max(0, oldOrder.subtotal - newSubtotal);

                // Update order with new subtotal and re-calculate total
                await client.query(
                    `UPDATE orders SET 
                        subtotal = $2,
                        total = GREATEST(0, $2 + shipping - discount_amount),
                        refund_eligible_amount = COALESCE(refund_eligible_amount, 0) + $3,
                        cancel_reason = COALESCE(cancel_reason, 'Partial Cancellation'),
                        refund_bank_account = COALESCE($4, refund_bank_account),
                        refund_ifsc_code = COALESCE($5, refund_ifsc_code),
                        refund_holder_name = COALESCE($6, refund_holder_name),
                        refund_status = $7,
                        updated_at = NOW()
                     WHERE id = $1`,
                    [
                        orderId,
                        newSubtotal,
                        refundValue,
                        bankDetails?.accountNumber || null,
                        bankDetails?.ifscCode || null,
                        bankDetails?.holderName || null,
                        (oldOrder.payment_method?.toLowerCase() !== 'cod') ? 'Pending' : oldOrder.refund_status
                    ]
                );
                
                await client.query('COMMIT');
                return await exports.getOrderById(orderId);
            }
        }

        // Update status
        let updateQuery;
        let updateParams;

        if (status === 'Cancelled' || status === 'Cancellation Processing' || status === 'CANCEL_REQUESTED') {
            updateQuery = `UPDATE orders 
                           SET status = $2, 
                               cancel_reason = $3, 
                               original_status = COALESCE(original_status, $4), 
                               cancelled_at = NOW(), 
                               updated_at = NOW(),
                               refund_bank_account = COALESCE($5, refund_bank_account),
                               refund_ifsc_code = COALESCE($6, refund_ifsc_code),
                               refund_holder_name = COALESCE($7, refund_holder_name),
                               refund_status = COALESCE(refund_status, 'Pending'),
                               payment_status = COALESCE($8, payment_status)
                           WHERE id = $1 RETURNING *`;
            updateParams = [
                orderId, 
                status, 
                cancelReason || 'Admin Action', 
                oldStatus,
                bankDetails?.accountNumber || null,
                bankDetails?.ifscCode || null,
                bankDetails?.holderName || null,
                paymentStatus || null
            ];
        } else if (status === 'Delivered') {
            console.log(`[OrderService] Marking order ${orderId} as Delivered and Payment as ${paymentStatus || 'Paid'}`);
            updateQuery = `UPDATE orders SET status = $2, payment_status = $3, delivered_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`;
            updateParams = [orderId, status, paymentStatus || 'Paid'];
        } else if (status.includes('Return Approved') || status.includes('Return Rejected') || 
                   status.includes('Replace Approved') || status.includes('Replace Rejected') ||
                   status === 'Received at Homved' || status === 'Refunded' || status === 'Replaced') {
            
            const isRejected = status.includes('Rejected') || status.includes('Un-Approved');
            const isApproved = status.includes('Approved');
            
            // Pre-calculate values to avoid complex CASE statements in SQL
            let refundStatusVal = oldOrder.refund_status;
            if (status === 'Return Approved') refundStatusVal = 'Pending';
            else if (status === 'Refunded') refundStatusVal = 'Refunded';

            const productReceivedVal = (status === 'Received at Homved') ? true : oldIsProductReceived;
            const logisticsStatusVal = (status === 'Received at Homved') ? 'Received at Homved' : oldOrder.logistics_status;

            // PARTIAL UPDATE: If itemIds are provided, update those specific items
            if (itemIds && itemIds.length > 0) {
                console.log(`[OrderService] Partial Return/Replace update for order ${orderId}, items: ${JSON.stringify(itemIds)}, newStatus: ${status}`);
                await client.query(
                    `UPDATE order_items 
                     SET status = $2
                     WHERE order_id = $1::uuid AND id = ANY($3::uuid[])`,
                    [orderId, status, itemIds]
                );

                // If some items were rejected, maybe show that in the order
                if (isRejected) {
                    await client.query(
                        `UPDATE orders SET rejection_reason = $2, updated_at = NOW() WHERE id = $1`,
                        [orderId, cancelReason || 'Administrative decision']
                    );
                }
            }

            updateQuery = `UPDATE orders SET 
                           status = $2::text, 
                           rejection_reason = COALESCE($3::text, rejection_reason),
                           refund_status = $4::text,
                           is_product_received = $5::boolean,
                           logistics_status = $6::text,
                           updated_at = NOW() 
                           WHERE id = $1::uuid RETURNING *`;
            updateParams = [
                orderId, 
                status, 
                isRejected ? (cancelReason || 'Administrative decision') : null,
                refundStatusVal,
                productReceivedVal,
                logisticsStatusVal
            ];
            
            if (status === 'Replace Approved') {
                // Reset ONLY requested items to 'Confirmed' if itemIds provided, otherwise all
                const whereClause = (itemIds && itemIds.length > 0) ? `order_id = $1 AND id = ANY($2::integer[])` : `order_id = $1`;
                const params = (itemIds && itemIds.length > 0) ? [orderId, itemIds] : [orderId];
                
                await client.query(`UPDATE order_items SET status = 'Confirmed' WHERE ${whereClause}`, params);
            }
        } else {
            updateQuery = `UPDATE orders SET 
                           status = $2::text, 
                           payment_status = CASE 
                                            WHEN $2::text = 'Delivered' THEN 'Paid'
                                            WHEN $2::text = 'Refunded' THEN 'Refunded'
                                            WHEN $3::text IS NOT NULL THEN $3::text
                                            ELSE payment_status 
                                          END,
                           is_product_received = CASE WHEN $2::text = 'Received at Homved' THEN TRUE ELSE is_product_received END,
                           logistics_status = CASE WHEN $2::text = 'Received at Homved' THEN 'Received at Homved' ELSE logistics_status END,
                           updated_at = NOW() WHERE id = $1::uuid RETURNING *`;
            updateParams = [orderId, status, paymentStatus];
        }

        const updateResult = await client.query(updateQuery, updateParams);

        // Sync all items to the same status if order status changed (standard delivery cycle sync)
        // EXCEPTION: Do not sync items that are 'Cancelled' or in a Return/Replace process
        const syncableStatuses = ['Pending', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Returned', 'Refunded'];
        const itemExcludedStatuses = ['Cancelled', 'Returned', 'Refunded', 'Return Request Processing', 'Replacement Request Processing', 'Return Approved', 'Return Rejected', 'Replace Approved', 'Replace Rejected'];
        
        if (syncableStatuses.includes(status)) {
            await client.query(
                `UPDATE order_items 
                 SET status = $1 
                 WHERE order_id = $2 AND (status IS NULL OR status NOT IN (SELECT unnest($3::text[])))`, 
                [status, orderId, itemExcludedStatuses]
            );
        }

        // Fetch the full enriched order after update to ensure frontend receives address/email details
        const order = await exports.getOrderById(orderId);

        // INVENTORY AUTOMATION (Common for All Methods)
        // Triggered SPECIFICALLY when status changes to 'Received at Homved' (Or finalized online)
        // As per HOMVED-014: "Product quantities must auto-increment specifically when status is 'Received at Homved'"
        const isReceivedAtHomved = status === 'Received at Homved';
        const isOnlineFinalization = ['Refunded', 'Returned'].includes(status);

        if ((isReceivedAtHomved || isOnlineFinalization) && !oldIsProductReceived) {
            // Only restore stock for items NOT already cancelled (partial cancellation logic)
            const itemsResult = await client.query(`SELECT product_id, quantity FROM order_items WHERE order_id = $1 AND (status IS NULL OR status != 'Cancelled')`, [orderId]);
            console.log(`[INVENTORY AUTOMATION] Restoring stock for remaining items of order ${orderId} (Status: ${status}). Items: ${itemsResult.rows.length}`);
            
            for (const item of itemsResult.rows) {
                await client.query(
                    `UPDATE products 
                     SET stock_quantity = stock_quantity + $2,
                         quantity = quantity + $2,
                         instock = true,
                         updated_at = NOW()
                     WHERE product_id = $1::integer`,
                    [item.product_id, item.quantity]
                );
            }
            // Mark as product received in DB if we just restocked
            await client.query(`UPDATE orders SET is_product_received = TRUE, updated_at = NOW() WHERE id = $1`, [orderId]);
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

exports.updateRefundStatus = async (orderId, refundData) => {
    const { refundStatus, adminNote, txnId, receiptUrl, notifyCustomer, bankDetails } = refundData;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const orderQuery = await client.query(`SELECT payment_method, logistics_status, is_product_received FROM orders WHERE id = $1`, [orderId]);
        if (orderQuery.rows.length === 0) throw new Error('Order not found');
        const orderInfo = orderQuery.rows[0];
        const isOnline = orderInfo.payment_method?.toLowerCase() !== 'cod';
        const oldIsProductReceived = orderInfo.is_product_received;

        const transitioningToFinal = refundStatus === 'Completed' || refundStatus === 'Refunded';
        
        if (isOnline && transitioningToFinal && !txnId) {
            throw new Error('Transaction ID is mandatory for finalizing online refunds.');
        }

        const updateResult = await client.query(
            `UPDATE orders 
             SET refund_status = $2::text, 
                 refund_admin_note = $3::text, 
                 rejection_reason = CASE WHEN $2::text IN ('Rejected', 'Denied') THEN $3::text ELSE rejection_reason END,
                 refund_txn_id = COALESCE(NULLIF($4::text, ''), refund_txn_id),
                 refund_receipt_url = COALESCE(NULLIF($5::text, ''), refund_receipt_url),
                 refund_processed_at = CASE WHEN $2::text IN ('Completed', 'Refunded', 'Rejected', 'Denied') THEN NOW() ELSE refund_processed_at END,
                 refund_notification_sent = CASE WHEN $6::boolean = TRUE THEN TRUE ELSE refund_notification_sent END,
                 logistics_status = COALESCE($7::text, logistics_status),
                 is_product_received = CASE 
                                        WHEN $2::text IN ('Restocked') OR $7::text IN ('Received', 'Restocked', 'Received at Homved') THEN TRUE 
                                        ELSE is_product_received 
                                       END,
                 status = CASE 
                            WHEN $2::text IN ('Completed', 'Refunded', 'Success') THEN 'Refunded' 
                            WHEN $2::text IN ('Rejected', 'Denied', 'Restocked') THEN 'Cancelled'
                            ELSE status 
                          END,
                 refund_bank_account = COALESCE($8::text, refund_bank_account),
                 refund_ifsc_code = COALESCE($9::text, refund_ifsc_code),
                 refund_holder_name = COALESCE($10::text, refund_holder_name),
                 updated_at = NOW() 
             WHERE id = $1 
             RETURNING *`,
            [orderId, refundStatus, adminNote, txnId || null, receiptUrl || null, notifyCustomer === true, refundData.logisticsStatus || null, refundData.bankDetails?.accountNumber || null, refundData.bankDetails?.ifscCode || null, refundData.bankDetails?.holderName || null]
        );

        if (updateResult.rows.length === 0) throw new Error('Order not found');
        const order = updateResult.rows[0];

        // INVENTORY AUTOMATION (Based on Logistics)
        const newLogistics = order.logistics_status;
        const reachedReceived = (newLogistics === 'Received' || newLogistics === 'Received at Homved' || newLogistics === 'Restocked' || refundStatus === 'Restocked') && 
                                !orderInfo.is_product_received;

        if (reachedReceived) {
            const itemsResult = await client.query(`SELECT product_id, quantity FROM order_items WHERE order_id = $1`, [orderId]);
            console.log(`[LOGISTICS INVENTORY] Product reached Homved. Restoring stock for order ${orderId}.`);
            
            for (const item of itemsResult.rows) {
                await client.query(
                    `UPDATE products 
                     SET stock_quantity = stock_quantity + $2,
                         quantity = quantity + $2,
                         instock = true,
                         updated_at = NOW()
                     WHERE product_id = $1::integer`,
                    [item.product_id, item.quantity]
                );
            }
        }

        // Placeholder for Notification Logic
        if (notifyCustomer) {
            console.log(`[Notification] Would send notification to user for order ${orderId} with status ${refundStatus}`);
            // e.g., msgService.sendRefundUpdate(order.user_id, refundStatus, adminNote);
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
exports.restockOrder = async (orderId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch order details to verify COD and current status
        const orderRes = await client.query(
            `SELECT id, payment_method, status, refund_status FROM orders WHERE id = $1`,
            [orderId]
        );

        if (orderRes.rows.length === 0) throw new Error('Order not found');
        const order = orderRes.rows[0];

        if (order.payment_method?.toLowerCase() !== 'cod') {
            throw new Error('Only COD orders can use the specialized restock workflow.');
        }

        if (order.refund_status === 'Restocked' || order.refund_status === 'Completed') {
            throw new Error('Order items have already been restocked or settled.');
        }

        // 2. Fetch order items
        const itemsResult = await client.query(
            `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
            [orderId]
        );

        console.log(`[RESTOCK] Restoring stock for COD order ${orderId}. Items count: ${itemsResult.rows.length}`);

        // 3. Increment stock for each item
        for (const item of itemsResult.rows) {
            await client.query(
                `UPDATE products 
                 SET stock_quantity = stock_quantity + $2,
                     quantity = quantity + $2,
                     instock = true,
                     updated_at = NOW()
                 WHERE product_id = $1::integer`,
                [item.product_id, item.quantity]
            );
        }

        // 4. Update order statuses
        const updateResult = await client.query(
            `UPDATE orders 
             SET status = 'Returned',
                 refund_status = 'Restocked',
                 refund_admin_note = COALESCE(refund_admin_note || ' ', '') || 'Items manually restocked by admin.',
                 refund_processed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1 
             RETURNING *`,
            [orderId]
        );

        await client.query('COMMIT');
        return updateResult.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.updateOrderItemStatus = async (orderId, itemId, status) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verify item belongs to order
        const itemRes = await client.query(`SELECT id FROM order_items WHERE id = $1::uuid AND order_id = $2::uuid`, [itemId, orderId]);
        if (itemRes.rows.length === 0) throw new Error('Item not found in this order');

        const updateQuery = `UPDATE order_items SET status = $1 WHERE id = $2::uuid RETURNING *`;
        const result = await client.query(updateQuery, [status, itemId]);

        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
