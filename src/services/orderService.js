const pool = require('../config/db');
const couponService = require('./couponService');
const paymentService = require('./paymentService');
const dtdcService = require('./dtdcService');
const whatsappService = require('./whatsappService');
const settingsService = require('./settingsService');

// ── Reverse logistics (parcel collection from customer) lifecycle ──────────
// Return:  Return Approved → Return Pickup Scheduled → Return Out for Pickup → Return Collected → Return In Transit → Received at Homved → Refunded
// Replace: Replace Approved → Replace Pickup Scheduled → Replace Out for Pickup → Replace Collected → Replace In Transit → Received at Homved
//          → Replacement Processing → Replacement Shipped → Replacement Out for Delivery → Replaced
const RETURN_PICKUP_STAGES = ['Return Pickup Scheduled', 'Return Out for Pickup', 'Return Collected', 'Return In Transit'];
const REPLACE_PICKUP_STAGES = ['Replace Pickup Scheduled', 'Replace Out for Pickup', 'Replace Collected', 'Replace In Transit'];
const REPLACEMENT_DELIVERY_STAGES = ['Replacement Processing', 'Replacement Shipped', 'Replacement Out for Delivery'];
const RETURN_CYCLE_ITEM_STATUSES = ['Return Approved', 'Return Processing', ...RETURN_PICKUP_STAGES];
const REPLACE_CYCLE_ITEM_STATUSES = ['Replace Approved', ...REPLACE_PICKUP_STAGES, ...REPLACEMENT_DELIVERY_STAGES];

// QA inspection outcome statuses (after parcel is Received at Homved)
const QA_STATUSES = ['Return QA Passed', 'Return QA Failed', 'Replace QA Passed', 'Replace QA Failed'];
// Return orders in these states cannot be refunded until QA has passed
const REFUND_BLOCKED_UNTIL_QA = ['Return Approved', 'Return Processing', ...RETURN_PICKUP_STAGES, 'Received at Homved', 'Return QA Failed'];

// ── List-query column projection ───────────────────────────────────────────
// orders.return_images stores base64 photos (up to ~1MB per order). Selecting o.* in list endpoints
// transfers all of it over the network on every request/poll. List queries use this projection instead.
const HEAVY_ORDER_COLUMNS = ['return_images'];
let orderListColumnsCache = null;
const getOrderListColumns = async () => {
    if (orderListColumnsCache) return orderListColumnsCache;
    const res = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'orders' ORDER BY ordinal_position`
    );
    orderListColumnsCache = res.rows
        .map(r => r.column_name)
        .filter(c => !HEAVY_ORDER_COLUMNS.includes(c))
        .map(c => `o."${c.replace(/"/g, '""')}"`)
        .join(', ');
    return orderListColumnsCache;
};

// Real goods value of a free replacement (-REP) order: replaced quantities × the unit price
// paid on the parent order. (The -REP order itself is ₹0 for the customer.)
const REPLACEMENT_VALUE_SQL = `
    CASE WHEN o.is_replacement = TRUE THEN (
        SELECT ROUND(COALESCE(SUM(ri.quantity * COALESCE(
            (SELECT MAX(pi.price) FROM order_items pi
             WHERE pi.order_id = o.parent_order_id AND pi.product_id = ri.product_id), 0)), 0), 2)
        FROM order_items ri WHERE ri.order_id = o.id
    ) END AS replacement_value`;

let qaColumnsEnsured = false;
const ensureQaColumns = async () => {
    if (qaColumnsEnsured) return;
    await pool.query(`
        ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS qa_status VARCHAR(20);
        ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS qa_notes TEXT;
        ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS qa_checked_at TIMESTAMP;
        ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS qa_checked_by VARCHAR(100);
    `);
    qaColumnsEnsured = true;
};

/**
 * HOMVED-MULTI-PRODUCT: Centralized Parent Order Status Resolver
 * Determines the overall operational status of an order based on the individual lifecycle states of its items.
 */
const resolveParentOrderStatus = (items, existingOrderStatus) => {
    if (!items || items.length === 0) return existingOrderStatus || 'Confirmed';

    const totalItems = items.length;
    const cancelledCount = items.filter(i => ['Cancelled', 'CANCEL_APPROVED'].includes(i.status)).length;
    const cancelRequestedCount = items.filter(i => ['Cancellation Requested', 'CANCEL_REQUESTED'].includes(i.status)).length;
    
    // 1. If every item is cancelled -> Cancelled
    if (cancelledCount === totalItems) return 'Cancelled';
    
    // 2. If every item is either cancelled or cancellation requested -> Cancellation Requested
    if (cancelledCount + cancelRequestedCount === totalItems) return 'Cancellation Requested';

    // 3. Post-Delivery lifecycles (Delivered, Returns, Replacements)
    const isPostDeliveryOrder = existingOrderStatus === 'Delivered' || existingOrderStatus === 'Replaced' ||
        (existingOrderStatus && (existingOrderStatus.includes('Return') || existingOrderStatus.includes('Replace') || existingOrderStatus === 'Received at Homved'));

    if (isPostDeliveryOrder) {
        // Items kept by customer: normal delivered items, rejected items, or completed Replaced items
        const keptDeliveredItems = items.filter(i => {
            const st = (i.status || '').toLowerCase();
            if (st.includes('reject') || st.includes('denied')) return true;
            if (st === 'replaced') return true;
            return !st.includes('return') && !st.includes('replace') && !st.includes('cancel') && !st.includes('refund');
        });

        // Items still actively in-progress in return or replace cycle
        const activeCycleItems = items.filter(i => {
            const st = (i.status || '').toLowerCase();
            if (st.includes('reject') || st.includes('denied')) return false;
            if (st === 'replaced' || st === 'returned' || st === 'refunded') return false;
            return st.includes('return') || st.includes('replace') || st === 'received at homved';
        });

        // If no items are actively in progress anymore:
        if (activeCycleItems.length === 0) {
            const allReplaced = items.length > 0 && items.every(i => (i.status || '').toLowerCase() === 'replaced');
            if (allReplaced || existingOrderStatus === 'Replaced') {
                return 'Replaced';
            }
            if (keptDeliveredItems.length > 0) {
                if (existingOrderStatus && (existingOrderStatus.includes('Reject') || existingOrderStatus.includes('Denied'))) {
                    return existingOrderStatus;
                }
                const allRejected = items.every(i => {
                    const st = (i.status || '').toLowerCase();
                    return st.includes('reject') || st.includes('denied');
                });
                if (allRejected) {
                    return (existingOrderStatus?.includes('Replace') || items.some(i => (i.status || '').includes('Replace')))
                        ? 'Replace Rejected'
                        : 'Return Rejected';
                }
                const hasReplacedItem = items.some(i => (i.status || '').toLowerCase() === 'replaced');
                return hasReplacedItem ? 'Replaced' : 'Delivered';
            }
            return existingOrderStatus || 'Delivered';
        }

        const hasReplace = activeCycleItems.some(i => (i.status || '').toLowerCase().includes('replace'));
        if (hasReplace) {
            const replaceCycleOrder = [
                'Replace QA Passed',
                'Replacement Out for Delivery',
                'Replacement Shipped',
                'Replacement Processing',
                'Received at Homved',
                'Replace In Transit',
                'Replace Collected',
                'Replace Out for Pickup',
                'Replace Pickup Scheduled',
                'Replace Approved',
                'Replacement Request Processing',
                'Replace Requested'
            ];
            for (const stage of replaceCycleOrder) {
                if (activeCycleItems.some(i => (i.status || '').toLowerCase() === stage.toLowerCase())) {
                    return stage;
                }
            }
            return 'Replacement Request Processing';
        }

        const returnCycleOrder = [
            'Return QA Passed',
            'Received at Homved',
            'Return In Transit',
            'Return Collected',
            'Return Out for Pickup',
            'Return Pickup Scheduled',
            'Return Approved',
            'Return Request Processing',
            'Return Requested'
        ];
        for (const stage of returnCycleOrder) {
            if (activeCycleItems.some(i => (i.status || '').toLowerCase() === stage.toLowerCase())) {
                return stage;
            }
        }
        return 'Return Request Processing';
    }

    // 4. Pre-Delivery lifecycles: If some items are cancelled but forward active items remain,
    // preserve the forward progression status (Confirmed, Processing, Shipped, etc.)
    const activeForwardItems = items.filter(i => {
        const st = (i.status || '').toLowerCase();
        return !st.includes('cancel');
    });

    if (activeForwardItems.length > 0) {
        if (existingOrderStatus === 'Cancellation Requested' || existingOrderStatus === 'CANCEL_REQUESTED') {
            return 'Confirmed';
        }
        return existingOrderStatus || 'Confirmed';
    }

    return existingOrderStatus || 'Confirmed';
};

const calculateCodBalanceDue = async (client, orderId) => {
    const orderRes = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (orderRes.rows.length === 0) return 0;
    const order = orderRes.rows[0];
    if (order.payment_method?.toLowerCase() !== 'cod') return 0;

    const itemsRes = await client.query(
        'SELECT price, quantity, status FROM order_items WHERE order_id = $1',
        [orderId]
    );

    const activeItems = itemsRes.rows.filter(it => {
        const st = (it.status || '').toLowerCase();
        if (st.includes('reject') || st.includes('denied')) return true;
        return !st.includes('cancel') && !st.includes('return') && !st.includes('refund');
    });

    if (activeItems.length === 0) {
        await client.query('UPDATE orders SET cod_balance_due = 0, updated_at = NOW() WHERE id = $1', [orderId]);
        return 0;
    }

    const activeSubtotal = activeItems.reduce((sum, it) => sum + (parseFloat(it.price) * parseInt(it.quantity)), 0);
    const initialSubtotal = parseFloat(order.initial_subtotal || order.subtotal || activeSubtotal);
    const discount = parseFloat(order.discount_amount || 0);
    const proportionalDiscount = initialSubtotal > 0 ? (activeSubtotal / initialSubtotal) * discount : 0;
    const shipping = parseFloat(order.shipping || 0);

    const codBalanceDue = Math.max(0, Math.round((activeSubtotal - proportionalDiscount + shipping) * 100) / 100);

    await client.query(
        'UPDATE orders SET cod_balance_due = $2, updated_at = NOW() WHERE id = $1',
        [orderId, codBalanceDue]
    );
    return codBalanceDue;
};

exports.createOrder = async (orderData) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const {
            userId, orderNumber, addressId, paymentMethod, paymentStatus, paymentType,
            subtotal, shipping, total, items, trackingNumber, estimatedDelivery,
            couponCode,   // optional — sent from Checkout.tsx when user applied a coupon
            cartItemIds,
            customerName,
            customerPhone
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

        // ── SECURITY & STOCK VALIDATION (HOM-MAX-QTY & COD PROTECTION) ────────
        const MAX_ITEM_QUANTITY = 10;
        const MAX_COD_TOTAL = 10000;
        const MAX_COD_ITEMS = 20;

        if (!items || !Array.isArray(items) || items.length === 0) {
            throw new Error('Order must contain at least one item');
        }

        let totalOrderUnits = 0;
        const prodIdList = [];
        for (const item of items) {
            const qty = parseInt(item.quantity, 10);
            const prodId = parseInt(item.id || item.productId, 10);
            if (isNaN(qty) || qty <= 0) {
                throw new Error(`Invalid quantity for item ${item.name || prodId}`);
            }
            if (qty > MAX_ITEM_QUANTITY) {
                throw new Error(`Maximum purchase limit is ${MAX_ITEM_QUANTITY} units per product. Item '${item.name || prodId}' requested ${qty} units.`);
            }
            totalOrderUnits += qty;
            prodIdList.push(prodId);
        }

        // Single batched atomic stock check with row lock (prevents N sequential DB roundtrips)
        const prodStockRes = await client.query(
            `SELECT product_id, productname, stock_quantity, instock FROM products WHERE product_id = ANY($1::integer[]) FOR UPDATE`,
            [prodIdList]
        );
        const prodMap = new Map();
        prodStockRes.rows.forEach(r => prodMap.set(parseInt(r.product_id, 10), r));

        for (const item of items) {
            const prodId = parseInt(item.id || item.productId, 10);
            const qty = parseInt(item.quantity, 10);
            const productRow = prodMap.get(prodId);
            if (!productRow) {
                throw new Error(`Product '${item.name || prodId}' not found.`);
            }
            const currentStock = parseInt(productRow.stock_quantity, 10) || 0;
            if (currentStock < qty || !productRow.instock) {
                throw new Error(`Insufficient stock for '${productRow.productname}'. Requested: ${qty}, Available: ${currentStock}.`);
            }
        }

        // ── STEP 1: Taxes, Surcharges & Coupon validation (server-side) ──────
        const storeSettings = await settingsService.getSettings();
        
        let calculatedGst = 0;
        if (storeSettings.gst?.enabled) {
            const gstRate = parseFloat(storeSettings.gst?.defaultRate || 0);
            if (!storeSettings.gst?.inclusive) {
                calculatedGst = Math.round(dbSubtotal * (gstRate / 100));
            }
        }

        let calculatedCardSurcharge = 0;
        if (storeSettings.cardSurcharge?.enabled && (paymentMethod === 'card' || paymentMethod === 'online')) {
            const surchargeRate = parseFloat(storeSettings.cardSurcharge?.rate || 0);
            calculatedCardSurcharge = Math.round(dbSubtotal * (surchargeRate / 100));
        }

        let calculatedCodCharge = 0;
        if (storeSettings.codCharge?.enabled && paymentMethod === 'cod') {
            calculatedCodCharge = parseFloat(storeSettings.codCharge?.amount || 0);
        }

        const freeShippingThreshold = storeSettings.storefront?.freeShippingThreshold ?? 499;
        const effectiveShipping = dbSubtotal >= freeShippingThreshold ? 0 : parseFloat(shipping || 50);

        // We never trust the client's `total`. We always recompute here.
        let discountAmount = 0;
        let couponId = null;                // FK → coupons.id; null if no coupon applied
        let validatedCouponCode = null;
        // originalTotal = pre-discount total (dbSubtotal + shipping + gst + surcharge + cod); used for audit clarity
        const originalTotal = dbSubtotal + effectiveShipping + calculatedGst + calculatedCardSurcharge + calculatedCodCharge;
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
            finalTotal = originalTotal - discountAmount;

            if (finalTotal < 0) finalTotal = 0;
        }

        // Validate Cash on Delivery (COD) limits to prevent inventory exhaustion
        if (paymentMethod === 'cod') {
            if (totalOrderUnits > MAX_COD_ITEMS) {
                throw new Error(`Cash on Delivery is limited to a maximum of ${MAX_COD_ITEMS} total units per order. Please choose an online payment method for bulk orders.`);
            }
            if (finalTotal > MAX_COD_TOTAL) {
                throw new Error(`Cash on Delivery is available only for orders up to ₹${MAX_COD_TOTAL}. Please choose an online payment method.`);
            }
        }

        // ── STEP 2: Insert order with coupon fields & approval mode ───────────
        const approvalMode = await exports.getOrderApprovalMode();
        // Automatic: COD orders auto-confirmed; Manual: stays Pending
        const initialStatus = (approvalMode === 'automatic' && paymentMethod === 'cod') ? 'Confirmed' : 'Pending';

        const orderResult = await client.query(
            `INSERT INTO orders (
                user_id, order_number, address_id, payment_method, payment_status, payment_type,
                subtotal, initial_subtotal, original_total, shipping,
                discount_amount, total,
                coupon_code, coupon_id,
                status, tracking_number, estimated_delivery,
                gst_amount, card_surcharge, cod_charge,
                created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13, $16, $14, $15, $17, $18, $19, NOW(), NOW())
            RETURNING *`,
            [
                userId,                          // $1
                orderNumber,                     // $2
                addressId,                       // $3
                paymentMethod,                   // $4
                paymentStatus || 'Pending',      // $5
                paymentType || (paymentMethod === 'cod' ? 'COD' : 'Pending'), // $6
                dbSubtotal,                      // $7  — server-computed cart sum, never client value
                originalTotal,                   // $8  — pre-discount total
                effectiveShipping,               // $9
                discountAmount,                  // $10 — 0 if no coupon
                finalTotal,                      // $11 — server-computed, never from client
                validatedCouponCode || null,     // $12 — normalized code string (kept for history)
                couponId,                        // $13 — FK → coupons.id; null if no coupon
                trackingNumber,                  // $14
                estimatedDelivery,               // $15
                initialStatus,                   // $16
                calculatedGst,                   // $17
                calculatedCardSurcharge,         // $18
                calculatedCodCharge              // $19
            ]
        );

        const order = orderResult.rows[0];
        console.log(`[OrderService] Order inserted successfully: ID ${order.id}`);

        // Update user's fullname and contactno if provided during checkout so user profile and invoices match
        const cleanCustomerName = (customerName || '').trim();
        const cleanCustomerPhone = (customerPhone || '').trim();
        if (userId && (cleanCustomerName || cleanCustomerPhone)) {
            try {
                await client.query(
                    `UPDATE users 
                     SET fullname = COALESCE(NULLIF($1, ''), fullname),
                         contactno = COALESCE(NULLIF($2, ''), contactno)
                     WHERE username = $3`,
                    [cleanCustomerName || null, cleanCustomerPhone || null, userId]
                );
            } catch (uErr) {
                console.warn('[OrderService] Could not update user fullname:', uErr.message);
            }
        }

        // ── STEP 3: Consume coupon usage & assignment ──────────────────────────
        if (validatedCouponCode) {
            await couponService.consumeCouponUsage(client, validatedCouponCode, couponId, userId);
        }

        // ── STEP 4: Insert order items + update stock ──────────────────────────
        for (const item of items) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, name, price, quantity, image, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [order.id, item.id || item.productId, item.name, item.price, item.quantity, item.image]
            );

            await client.query(
                `UPDATE products
                 SET stock_quantity = GREATEST(0, stock_quantity - $2),
                     quantity       = GREATEST(0, quantity - $2),
                     instock        = CASE WHEN GREATEST(0, stock_quantity - $2) <= 0 THEN false ELSE instock END,
                     updated_at     = NOW()
                 WHERE product_id = $1::integer`,
                [item.id || item.productId, item.quantity]
            );
        }

        // ── STEP 5: Clear cart ─────────────────────────────────────────────────
        // Only clear the cart immediately for COD orders. For online/card/UPI payments,
        // the cart is kept intact until successful payment verification on the frontend.
        // This ensures that if the user cancels or the payment fails, their cart is preserved.
        if (paymentMethod === 'cod') {
            if (cartItemIds && cartItemIds.length > 0) {
                await client.query(`DELETE FROM cart_items WHERE user_id = $1 AND product_id::integer = ANY($2::integer[])`, [userId, cartItemIds]);
            } else {
                await client.query(`DELETE FROM cart_items WHERE user_id = $1`, [userId]);
            }
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
    const { type } = options;

    const hasSpecificSearch = Boolean(options.orderNumber || options.userName);

    if (type === 'potential') {
        baseQuery += ` AND (o.payment_method != 'cod' AND o.payment_status != 'Paid' AND (o.payment_type IS NULL OR o.payment_type != 'Paid'))`;
    } else {
        // Standard admin views, searches, and filters must ONLY display legitimate confirmed orders:
        // COD orders or Online orders that were actually Paid.
        // Completely excludes abandoned/unpaid online payment attempts.
        baseQuery += ` AND (o.payment_method = 'cod' OR o.payment_status = 'Paid' OR o.payment_type = 'Paid')`;
    }

    const params = [];
    let paramIndex = 1;

    if (status && status !== 'all') {
        if (status === 'Cancelled') {
            baseQuery += ` AND (o.status = 'Cancelled' OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'Cancelled'))`;
        } else if (status === 'Partially Cancelled') {
            baseQuery += ` AND (
                EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'Cancelled')
                AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND (oi.status IS NULL OR oi.status NOT IN ('Cancelled', 'Returned', 'Refunded')))
            )`;
        } else if (status === 'Cancellation Requested') {
            baseQuery += ` AND (o.status IN ('Cancellation Requested', 'CANCEL_REQUESTED') OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.status IN ('Cancellation Requested', 'CANCEL_REQUESTED')))`;
        } else if (status === 'Return Request Processing') {
            baseQuery += ` AND (o.status IN ('Return Request Processing', 'Return Requested') OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.status IN ('Return Request Processing', 'Return Requested')))`;
        } else if (status === 'Replacement Request Processing') {
            baseQuery += ` AND (o.status IN ('Replacement Request Processing', 'Replace Requested') OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.status IN ('Replacement Request Processing', 'Replace Requested')))`;
        } else if (status === 'Returned') {
            baseQuery += ` AND (o.status IN ('Returned', 'Return Approved', 'Received at Homved') OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.status IN ('Returned', 'Return Approved', 'Received at Homved')))`;
        } else if (status === 'Refunded') {
            baseQuery += ` AND (o.status = 'Refunded' OR o.payment_status = 'Refunded' OR o.refund_status IN ('Refunded', 'Completed') OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'Refunded'))`;
        } else if (status === 'Replaced') {
            baseQuery += ` AND (o.status IN ('Replaced', 'Replace Approved', 'Replacement Out for Delivery') OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.status IN ('Replaced', 'Replace Approved', 'Replacement Out for Delivery')))`;
        } else {
            baseQuery += ` AND (o.status = $${paramIndex} OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.status = $${paramIndex}))`;
            params.push(status);
            paramIndex++;
        }
    }

    if (paymentStatus && paymentStatus !== 'all') {
        if (paymentStatus === 'Refunded') {
            baseQuery += ` AND (o.payment_status = 'Refunded' OR o.refund_status IN ('Refunded', 'Completed'))`;
        } else if (paymentStatus === 'Pending') {
            baseQuery += ` AND o.payment_status = 'Pending' AND o.status NOT IN ('Cancelled', 'Returned') AND NOT (EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'Cancelled') AND NOT EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id = o.id AND (oi2.status IS NULL OR oi2.status NOT IN ('Cancelled', 'Returned'))))`;
        } else {
            baseQuery += ` AND o.payment_status = $${paramIndex}`;
            params.push(paymentStatus);
            paramIndex++;
        }
    }

    if (options.paymentType && options.paymentType !== 'all') {
        if (options.paymentType === 'COD') {
            baseQuery += ` AND (LOWER(o.payment_method) = 'cod' OR o.payment_type = 'COD')`;
        } else if (options.paymentType === 'Paid') {
            baseQuery += ` AND (LOWER(o.payment_method) != 'cod' AND (o.payment_type IS NULL OR o.payment_type != 'COD'))`;
        }
    }

    if (options.userName) {
        const cleanUser = options.userName.trim();
        baseQuery += ` AND (
            u.username ILIKE $${paramIndex}
            OR u.emailid ILIKE $${paramIndex}
            OR u.fullname ILIKE $${paramIndex}
            OR u.contactno ILIKE $${paramIndex}
            OR o.refund_phone_number ILIKE $${paramIndex}
            OR a.full_address ILIKE $${paramIndex}
            OR a.city ILIKE $${paramIndex}
        )`;
        params.push(`%${cleanUser}%`);
        paramIndex++;
    }

    if (options.orderNumber) {
        const rawSearch = options.orderNumber.toString().trim();
        const cleanOrderNumber = rawSearch.replace(/^#/, '').trim();
        const normalizedSearch = cleanOrderNumber.replace(/[\s\-]/g, '');

        baseQuery += ` AND (
            o.order_number ILIKE $${paramIndex}
            OR o.id::text ILIKE $${paramIndex}
            OR o.tracking_number ILIKE $${paramIndex}
            OR REPLACE(REPLACE(o.order_number, '-', ''), ' ', '') ILIKE $${paramIndex + 1}
        )`;
        params.push(`%${cleanOrderNumber}%`);
        params.push(`%${normalizedSearch}%`);
        paramIndex += 2;
    }

    if (options.dateFrom) {
        baseQuery += ` AND o.created_at >= $${paramIndex}`;
        params.push(`${options.dateFrom} 00:00:00`);
        paramIndex++;
    }

    if (options.dateTo) {
        baseQuery += ` AND o.created_at <= $${paramIndex}`;
        params.push(`${options.dateTo} 23:59:59.999`);
        paramIndex++;
    }

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const totalCount = parseInt(countResult.rows[0].count);

    const queryParams = [...params, limit, offset];
    // Exclude heavy base64 return photos from the list payload (loaded on demand via GET /orders/:id)
    const orderColumns = await getOrderListColumns();

    const orderResult = await pool.query(
        `SELECT ${orderColumns}, u.fullname as customer_name, u.emailid as customer_email, u.contactno as customer_phone, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default,
                COALESCE(array_length(o.return_images, 1), 0) AS return_images_count,
                ${REPLACEMENT_VALUE_SQL},
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
    const { limit = 10, offset = 0, refundStatusFilter = 'All', searchTerm } = options;

    const queryParams = [];
    let baseQuery = `FROM orders o 
                     LEFT JOIN users u ON o.user_id = u.username 
                     LEFT JOIN user_addresses a ON o.address_id = a.id 
                     WHERE (
                        o.status IN ('CANCEL_REQUESTED', 'Cancelled', 'Refunded', 'Cancellation Requested', 'Returned', 'Received at Homved', 'Return Request Processing', 'Return Approved', 'Return Rejected', 'Return Processing', 'Return Collected', 'Restocked', 'Partially Returning', 'Return Requested')
                        OR o.is_returned_order = TRUE
                        OR o.return_type IS NOT NULL
                        OR EXISTS (
                            SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND (
                                oi.status IN ('Cancellation Requested', 'CANCEL_REQUESTED', 'Return Requested', 'Return Request Processing', 'Replace Requested', 'Replacement Request Processing', 'Returned', 'Return Approved', 'Refunded', 'Cancelled', 'Received at Homved', 'Restocked', 'Return Processing')
                                OR oi.status LIKE 'Return%'
                            )
                        )
                     )
                     AND (
                        (LOWER(o.payment_method) != 'cod' AND o.payment_status IN ('Paid', 'Refunded'))
                        OR o.is_returned_order = TRUE
                        OR o.return_type IS NOT NULL
                        OR o.status LIKE 'Return%' 
                        OR o.status IN ('Returned', 'Refunded', 'Received at Homved', 'Restocked', 'Partially Returning')
                        OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND (oi.status LIKE 'Return%' OR oi.status LIKE 'Replace%' OR oi.status IN ('Returned', 'Refunded', 'Received at Homved', 'Restocked')))
                     )`;

    if (searchTerm) {
        const cleanTerm = searchTerm.trim().replace(/^#/, '');
        baseQuery += ` AND (o.order_number ILIKE $1 OR u.emailid ILIKE $1 OR u.contactno ILIKE $1 OR a.full_address ILIKE $1 OR u.fullname ILIKE $1)`;
        queryParams.push(`%${cleanTerm}%`);
    }

    const paramOffsetIndex = queryParams.length + 1;

    // ── Refund Desk specific filtering ──────────────────────────────────────
    if (refundStatusFilter === 'active') {
        // Only show orders that are actively being processed for a refund.
        // Exclude: already Refunded/Completed, and unapproved online cancellation requests.
        // All returned orders (including COD returns) must always be visible for refund processing.
        baseQuery += `
                     AND (o.refund_status IS NULL OR o.refund_status NOT IN ('Refunded', 'Completed'))
                     AND NOT (
                         (o.refund_status = 'Pending' OR o.refund_status IS NULL)
                         AND o.status IN ('Cancellation Requested', 'CANCEL_REQUESTED')
                         AND (o.is_returned_order IS NOT TRUE AND o.status NOT LIKE 'Return%' AND o.status != 'Returned')
                     )`;
    } else if (refundStatusFilter && refundStatusFilter !== 'All') {
        // Explicit single-status filter (Pending, In-Review, Processing, Refunded, Rejected)
        if (refundStatusFilter === 'Pending') {
            baseQuery += ` AND (o.refund_status = 'Pending' OR o.refund_status IS NULL)`;
        } else if (refundStatusFilter === 'Refunded' || refundStatusFilter === 'Completed') {
            baseQuery += ` AND o.refund_status IN ('Refunded', 'Completed')`;
        } else {
            baseQuery += ` AND o.refund_status = '${refundStatusFilter.replace(/'/g, "''")}'`;
        }
    }
    // 'All' = no extra filter, return everything

    // Run count + page query in parallel (each is a network round trip to the remote DB)
    const countPromise = pool.query(`SELECT COUNT(*) ${baseQuery}`, queryParams);
    const orderColumns = await getOrderListColumns();

    const orderPromise = pool.query(
        `SELECT ${orderColumns}, u.fullname as customer_name, u.emailid as customer_email, u.contactno as customer_phone, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default,
                -- PERFORMANCE: return_images (base64 photos) is excluded from the list payload;
                -- the Refund Desk loads photos on demand via GET /orders/:id when a request is opened.
                COALESCE(array_length(o.return_images, 1), 0) AS return_images_count,
                COALESCE(
                    (SELECT json_agg(items_data)
                     FROM (
                         SELECT * FROM order_items WHERE order_id = o.id
                         ORDER BY created_at ASC
                     ) items_data
                    ), '[]'::json
                ) as items,
                -- ── REFUND AMOUNT CALCULATION ───────────────────────────────────
                -- Return orders: always use exact product price (sum of return item prices, no discount).
                -- Cancellation orders: use stored refund_eligible_amount (discount-on-last-product rule).
                CASE
                    WHEN o.is_returned_order = TRUE OR o.status LIKE 'Return%' OR o.status IN ('Returned', 'Refunded', 'Received at Homved') THEN
                        COALESCE(
                            NULLIF(
                                (SELECT ROUND(SUM(price * quantity), 2)
                                 FROM order_items
                                 WHERE order_id = o.id
                                   AND (status IN ('Return Request Processing', 'Return Requested', 'Return Approved', 'Return Processing', 'Return Collected', 'Received at Homved', 'Returned', 'Refunded', 'Restocked') OR status LIKE 'Return%')
                                ), 0
                            ),
                            NULLIF(o.refund_eligible_amount, 0),
                            o.total
                        )
                    ELSE
                        COALESCE(
                            NULLIF(o.refund_eligible_amount, 0),
                            (SELECT ROUND(SUM(price * quantity), 2)
                             FROM order_items
                             WHERE order_id = o.id
                               AND status IN ('Cancelled', 'Cancellation Requested', 'CANCEL_REQUESTED')
                            ),
                            o.total
                        )
                END as refund_eligible_amount,
                COALESCE(
                    (SELECT json_agg(i_data)
                     FROM (
                         SELECT name, quantity, price, status FROM order_items 
                         WHERE order_id = o.id AND (status = 'Cancelled' OR status = 'Returned' OR status = 'Return Approved' OR status = 'Return Request Processing' OR status = 'Cancellation Requested' OR status = 'Return Processing' OR status = 'Return Collected' OR status = 'Received at Homved' OR status = 'Restocked' OR status = 'Return Requested')
                     ) i_data
                    ), '[]'::json
                ) as refund_items
         ${baseQuery}
         ORDER BY 
            CASE 
              WHEN o.is_returned_order = TRUE 
                   OR o.return_type IS NOT NULL
                   OR o.status LIKE 'Return%'
                   OR o.status IN ('Cancelled', 'Partially Cancelled', 'Return Approved', 'Received at Homved', 'Returned', 'Refunded', 'Replace Approved', 'Replaced', 'Return Request Processing', 'Return Requested', 'Partially Returning', 'Return Processing', 'Return Collected') 
                   OR EXISTS (SELECT 1 FROM order_items WHERE order_id = o.id AND (status LIKE 'Return%' OR status LIKE 'Replace%' OR status IN ('Cancelled', 'Returned', 'Refunded', 'Return Approved', 'Replace Approved', 'Replaced'))) THEN 1 
              ELSE 2 
            END ASC,
            o.updated_at DESC
         LIMIT $${paramOffsetIndex} OFFSET $${paramOffsetIndex + 1}`,
        [...queryParams, limit, offset]
    );

    const [countResult, orderResult] = await Promise.all([countPromise, orderPromise]);
    const totalCount = parseInt(countResult.rows[0].count);

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
            COUNT(*) FILTER (
                WHERE (status IN ('CANCEL_REQUESTED', 'Cancelled', 'Refunded', 'Cancellation Requested', 'Returned', 'Received at Homved', 'Return Request Processing', 'Return Approved', 'Return Rejected', 'Return Processing', 'Return Collected', 'Restocked', 'Partially Returning', 'Return Requested')
                OR is_returned_order = TRUE
                OR return_type IS NOT NULL
                OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id AND (oi.status IN ('Cancellation Requested', 'CANCEL_REQUESTED', 'Returned', 'Return Approved', 'Refunded', 'Cancelled', 'Return Request Processing', 'Return Requested', 'Return Processing') OR oi.status LIKE 'Return%'))
                ) AND (LOWER(payment_method) != 'cod' OR is_returned_order = TRUE OR return_type IS NOT NULL OR status LIKE 'Return%' OR status IN ('Returned', 'Refunded', 'Received at Homved', 'Partially Returning'))
            ) as total_cancelled,
            COUNT(*) FILTER (
                WHERE (refund_status = 'Pending' OR refund_status IS NULL) 
                AND payment_status NOT IN ('Failed', 'Cancelled')
                AND ((LOWER(payment_method) != 'cod' AND payment_status IN ('Paid', 'Refunded')) OR is_returned_order = TRUE OR return_type IS NOT NULL OR status LIKE 'Return%' OR status IN ('Returned', 'Refunded', 'Received at Homved', 'Partially Returning'))
            ) as pending_refunds
         FROM orders`
    );
    return result.rows[0];
};

exports.getOrdersByUser = async (userId) => {
    // Auto-heal parent orders whose replacement child order is already delivered
    try {
        await pool.query(`
            UPDATE orders p
            SET status = 'Replaced', logistics_status = 'Delivered', updated_at = NOW()
            FROM orders r
            WHERE (r.parent_order_id = p.id OR r.original_order_id = p.id)
              AND (r.is_replacement = TRUE OR r.order_number LIKE '%-REP')
              AND r.status = 'Delivered'
              AND p.user_id = $1
              AND p.status != 'Replaced'
        `, [userId]);
        await pool.query(`
            UPDATE order_items
            SET status = 'Replaced'
            WHERE order_id IN (
                SELECT p.id FROM orders p
                JOIN orders r ON (r.parent_order_id = p.id OR r.original_order_id = p.id)
                WHERE (r.is_replacement = TRUE OR r.order_number LIKE '%-REP')
                  AND r.status = 'Delivered'
                  AND p.user_id = $1
            ) AND (status ILIKE '%replace%' OR status = 'Received at Homved')
        `, [userId]);
        // Auto-heal items in parent orders that were mistakenly marked 'Replaced' even though they were never replaced
        await pool.query(`
            UPDATE order_items p_item
            SET status = 'Delivered'
            WHERE p_item.status = 'Replaced'
              AND p_item.return_reason IS NULL
              AND p_item.order_id IN (
                  SELECT p.id FROM orders p
                  JOIN orders r ON (r.parent_order_id = p.id OR r.original_order_id = p.id OR r.order_number LIKE '%-REP')
                  WHERE (r.is_replacement = TRUE OR r.order_number LIKE '%-REP')
                    AND p.user_id = $1
              )
              AND p_item.id NOT IN (
                  SELECT COALESCE(r_item.parent_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  FROM order_items r_item
                  JOIN orders r ON r_item.order_id = r.id
                  WHERE (r.is_replacement = TRUE OR r.order_number LIKE '%-REP')
              )
              AND p_item.product_id NOT IN (
                  SELECT r_item.product_id
                  FROM order_items r_item
                  JOIN orders r ON r_item.order_id = r.id
                  WHERE (r.is_replacement = TRUE OR r.order_number LIKE '%-REP')
                    AND (r.parent_order_id = p_item.order_id OR r.original_order_id = p_item.order_id)
              )
        `, [userId]);
    } catch (healErr) {
        // Non-blocking
    }

    // Use json_agg to avoid N+1 query problem and improve performance.
    // Base64 return photos are excluded: customer order lists poll frequently and never display them.
    const orderColumns = await getOrderListColumns();
    const orderResult = await pool.query(
        `SELECT ${orderColumns}, u.fullname as customer_name, u.emailid as customer_email, u.contactno as customer_phone, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default,
                COALESCE(array_length(o.return_images, 1), 0) AS return_images_count,
                ${REPLACEMENT_VALUE_SQL},
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
           AND (o.payment_method = 'cod' OR o.payment_status = 'Paid' OR o.payment_type = 'Paid')
         ORDER BY o.created_at DESC`,
        [userId]
    );

    return orderResult.rows;
};

exports.getOrderById = async (orderId) => {
    // Auto-heal parent order if its replacement child is already delivered
    try {
        await pool.query(`
            UPDATE orders p
            SET status = 'Replaced', logistics_status = 'Delivered', updated_at = NOW()
            FROM orders r
            WHERE (r.parent_order_id = p.id OR r.original_order_id = p.id)
              AND (r.is_replacement = TRUE OR r.order_number LIKE '%-REP')
              AND r.status = 'Delivered'
              AND (p.id::text = $1 OR p.order_number = $1)
              AND p.status != 'Replaced'
        `, [String(orderId)]);
        await pool.query(`
            UPDATE order_items
            SET status = 'Replaced'
            WHERE order_id IN (
                SELECT p.id FROM orders p
                JOIN orders r ON (r.parent_order_id = p.id OR r.original_order_id = p.id)
                WHERE (r.is_replacement = TRUE OR r.order_number LIKE '%-REP')
                  AND r.status = 'Delivered'
                  AND (p.id::text = $1 OR p.order_number = $1)
            ) AND (status ILIKE '%replace%' OR status = 'Received at Homved')
        `, [String(orderId)]);
        // Auto-heal items in parent orders that were mistakenly marked 'Replaced' even though they were never replaced
        await pool.query(`
            UPDATE order_items p_item
            SET status = 'Delivered'
            WHERE p_item.status = 'Replaced'
              AND p_item.return_reason IS NULL
              AND p_item.order_id IN (
                  SELECT p.id FROM orders p
                  JOIN orders r ON (r.parent_order_id = p.id OR r.original_order_id = p.id OR r.order_number LIKE '%-REP')
                  WHERE (r.is_replacement = TRUE OR r.order_number LIKE '%-REP')
                    AND (p.id::text = $1 OR p.order_number = $1)
              )
              AND p_item.id NOT IN (
                  SELECT COALESCE(r_item.parent_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  FROM order_items r_item
                  JOIN orders r ON r_item.order_id = r.id
                  WHERE (r.is_replacement = TRUE OR r.order_number LIKE '%-REP')
              )
              AND p_item.product_id NOT IN (
                  SELECT r_item.product_id
                  FROM order_items r_item
                  JOIN orders r ON r_item.order_id = r.id
                  WHERE (r.is_replacement = TRUE OR r.order_number LIKE '%-REP')
                    AND (r.parent_order_id = p_item.order_id OR r.original_order_id = p_item.order_id)
              )
        `, [String(orderId)]);
    } catch (healErr) {
        // Non-blocking
    }

    const orderResult = await pool.query(
        `SELECT o.*, u.fullname as customer_name, u.emailid as customer_email, u.contactno as customer_phone, a.address_label, a.full_address, a.city, a.state, a.postal_code, a.is_default,
                ${REPLACEMENT_VALUE_SQL},
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
         WHERE o.id::text = $1 OR o.order_number = $1`,
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

        // Validate proof images (must be less than 5 MB per image)
        if (Array.isArray(images) && images.length > 0) {
            const MAX_IMG_BYTES = 5 * 1024 * 1024; // 5 MB
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                if (typeof img === 'string' && img.startsWith('data:image/')) {
                    const base64Str = img.split(',')[1] || '';
                    const approxSizeBytes = Math.round((base64Str.length * 3) / 4);
                    if (approxSizeBytes >= MAX_IMG_BYTES) {
                        throw new Error(`Proof photo ${i + 1} exceeds 5 MB limit. Please upload images less than 5 MB.`);
                    }
                }
            }
        }

        const windowDays = 7;
        const deliveredDate = order.delivered_at ? new Date(order.delivered_at) : null;
        if (!deliveredDate && order.status === 'Delivered') throw new Error('Delivery timestamp missing.');

        if (deliveredDate) {
            const diffDays = Math.ceil(Math.abs(new Date() - deliveredDate) / (1000 * 60 * 60 * 24));
            if (diffDays > windowDays) throw new Error(`Return window expired (${windowDays} days)`);
        }

        // 3. Process each item individually (Row Splitting for partial quantities)
        const isReturn = type === 'Return';
        if (isReturn) {
            if (!bankDetails || !bankDetails.ifscCode) {
                throw new Error("Bank IFSC code is required for refunds");
            }
            if (!bankDetails.holderName || !bankDetails.holderName.toString().trim()) {
                throw new Error("Account holder name is required for refunds");
            }
            if (/\d/.test(bankDetails.holderName)) {
                throw new Error("Account holder name must not contain numbers");
            }
            const cleanIfsc = bankDetails.ifscCode.toString().trim().toUpperCase();
            if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
                throw new Error("Please enter a valid 11-character IFSC code (e.g. HDFC0001234)");
            }
        }
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

                // INSERT new row as requested for return/replace (with parent_item_id and return_reason)
                await client.query(
                    `INSERT INTO order_items (
                        order_id, product_id, name, quantity, price, image, status, return_reason, parent_item_id, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
                    [orderId, originalItem.product_id, originalItem.name, returnQty, originalItem.price, originalItem.image, itemStatus, reason || 'Not specified', itemId]
                );
            } else {
                // FULL ROW: Update status and return_reason
                await client.query(`UPDATE order_items SET status = $1, return_reason = $2 WHERE id = $3::uuid`, [itemStatus, reason || 'Not specified', itemId]);
            }
        }

        // 4. Update Main Order Status
        const allItemsRes = await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
        const orderStatus = resolveParentOrderStatus(allItemsRes.rows, order.status);

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
                is_returned_order = $9::boolean,
                refund_status = CASE WHEN $9::boolean = TRUE THEN COALESCE(refund_status, 'Pending') ELSE refund_status END
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

/**
 * USER STORY 2 & 4: Item-Level Cancellation Request
 * Handles partial or full item cancellation with row-splitting for quantities.
 */
exports.requestItemCancellation = async (orderId, userId, data, isAdmin = false) => {
    const { cancelReason, items: requestedItems, bankDetails } = data;
    if (bankDetails && bankDetails.holderName && /\d/.test(bankDetails.holderName)) {
        throw new Error("Account holder name must not contain numbers");
    }
    console.log(`[OrderService] requestItemCancellation started for Order ${orderId}, Items: ${requestedItems?.length}`);
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

        // 2. Security & Validation (User Story 3)
        if (!isAdmin && order.user_id !== userId) throw new Error('Not authorized');

        // Only Pending/Processing/Confirmed orders are cancellable (admin can also cancel Shipped/Out for Delivery)
        const cancellableStatuses = isAdmin
            ? ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Cancellation Requested']
            : ['Pending', 'Confirmed', 'Processing'];
        if (!cancellableStatuses.includes(order.status)) {
            throw new Error(`Order with status '${order.status}' cannot be cancelled.`);
        }

        const itemStatus = 'Cancellation Requested';

        // 3. Process each item (Row Splitting)
        let totalCancelQty = 0;
        for (const reqItem of requestedItems) {
            const { id: itemId, quantity: cancelQty } = reqItem;

            const itemRes = await client.query(`SELECT * FROM order_items WHERE id = $1::uuid AND order_id = $2::uuid`, [itemId, orderId]);
            if (itemRes.rows.length === 0) continue;
            const originalItem = itemRes.rows[0];

            if (cancelQty > originalItem.quantity) throw new Error(`Invalid quantity for ${originalItem.name}`);

            totalCancelQty += cancelQty;

            if (cancelQty < originalItem.quantity) {
                // SPLIT ROW: Reduce original quantity
                await client.query(`UPDATE order_items SET quantity = quantity - $1 WHERE id = $2::uuid`, [cancelQty, itemId]);

                // INSERT new row as requested for cancellation (with parent_item_id)
                await client.query(
                    `INSERT INTO order_items (
                        order_id, product_id, name, quantity, price, image, status, cancel_reason, parent_item_id, created_at
                    ) VALUES ($1::uuid, $2, $3::text, $4::integer, $5::numeric, $6::text, $7::text, $8::text, $9::uuid, NOW())`,
                    [orderId, originalItem.product_id, originalItem.name, cancelQty, originalItem.price, originalItem.image, itemStatus, cancelReason || 'Not specified', itemId]
                );
            } else {
                // FULL ROW: Just update status and reason
                await client.query(`UPDATE order_items SET status = $1, cancel_reason = $2::text WHERE id = $3::uuid`, [itemStatus, cancelReason || 'Not specified', itemId]);
            }
        }

        // 4. Update Main Order Status & COD Balance Due
        const allCancelItemsRes = await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
        const mainOrderStatus = resolveParentOrderStatus(allCancelItemsRes.rows, order.status);

        // Recalculate remaining COD balance
        await calculateCodBalanceDue(client, orderId);

        await client.query(
            `UPDATE orders 
            SET status = $6::text,
                cancel_reason = COALESCE($2::text, cancel_reason, 'Not specified'),
                updated_at = NOW(),
                refund_bank_account = COALESCE($3::text, refund_bank_account),
                refund_ifsc_code = COALESCE($4::text, refund_ifsc_code),
                refund_holder_name = COALESCE($5::text, refund_holder_name),
                cancelled_at = CASE WHEN $6::text = 'Cancelled' THEN NOW() ELSE cancelled_at END
            WHERE id = $1::uuid`,
            [
                orderId,
                cancelReason || null,
                bankDetails?.accountNumber || null,
                bankDetails?.ifscCode || null,
                bankDetails?.holderName || null,
                mainOrderStatus
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
            COUNT(*) FILTER (WHERE payment_method = 'cod' OR payment_status = 'Paid' OR payment_type = 'Paid') as total,
            COUNT(*) FILTER (WHERE payment_method != 'cod' AND payment_status != 'Paid' AND (payment_type IS NULL OR payment_type != 'Paid')) as potential_users,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status = 'Paid' OR payment_type = 'Paid') AND status NOT IN ('Cancelled', 'Returned', 'Refunded')) as active,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status = 'Paid' OR payment_type = 'Paid') AND status = 'Pending') as pending,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status = 'Paid' OR payment_type = 'Paid') AND status = 'Processing') as processing,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status = 'Paid' OR payment_type = 'Paid') AND status IN ('Shipped', 'Confirmed')) as shipped,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status = 'Paid' OR payment_type = 'Paid') AND status = 'Out for Delivery') as out_for_delivery,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status = 'Paid' OR payment_type = 'Paid') AND status = 'Delivered') as delivered,
            COUNT(*) FILTER (WHERE (payment_method = 'cod' OR payment_status = 'Paid' OR payment_type = 'Paid') AND status IN ('Cancelled', 'Returned', 'Refunded', 'Cancellation Requested', 'Return Requested', 'Return Approved', 'Return Rejected', 'Replace Requested', 'Replace Approved', 'Replace Rejected', 'Received at Homved', 'Restocked')) as canceled,
            COUNT(*) FILTER (WHERE payment_method = 'cod' AND payment_status = 'Pending' AND status NOT IN ('Cancelled', 'Returned', 'Refunded')) as pending_payment,
            COUNT(*) FILTER (WHERE status = 'Return Request Processing' AND (payment_method = 'cod' OR payment_status = 'Paid' OR payment_type = 'Paid')) as return_requests,
            COUNT(*) FILTER (WHERE status = 'Replacement Request Processing' AND (payment_method = 'cod' OR payment_status = 'Paid' OR payment_type = 'Paid')) as replacement_requests,
            COUNT(*) FILTER (WHERE (status IN ('Cancellation Requested', 'CANCEL_REQUESTED') OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id AND oi.status IN ('Cancellation Requested', 'CANCEL_REQUESTED'))) AND (payment_method = 'cod' OR payment_status = 'Paid' OR payment_type = 'Paid')) as cancellation_requests
         FROM orders`
    );

    const stats = result.rows[0];
    return {
        total: parseInt(stats.total),
        potentialUsers: parseInt(stats.potential_users),
        active: parseInt(stats.active),
        pending: parseInt(stats.pending),
        processing: parseInt(stats.processing),
        shipped: parseInt(stats.shipped || 0),
        outForDelivery: parseInt(stats.out_for_delivery || 0),
        delivered: parseInt(stats.delivered),
        canceled: parseInt(stats.canceled),
        pendingPayment: parseInt(stats.pending_payment),
        returnRequests: parseInt(stats.return_requests || 0),
        replacementRequests: parseInt(stats.replacement_requests || 0),
        cancellationRequests: parseInt(stats.cancellation_requests || 0),
        allRecordsCount: parseInt(stats.total) // total rows in DB
    };
};

/**
 * Completely deletes an unpaid/abandoned online order from the database and restores stock and coupons.
 * Used when a user closes/dismisses Razorpay payment modal or payment fails.
 * Guarantees that unpaid orders do not appear in User Order History or Admin Panel.
 */
exports.deleteAbandonedOrder = async (orderId, userId = null) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let checkQuery = `SELECT id, user_id, payment_method, payment_status, payment_type, coupon_code, coupon_id FROM orders WHERE id = $1::uuid`;
        const checkParams = [orderId];
        if (userId) {
            checkQuery += ` AND (user_id = $2 OR $2 = 'guest' OR $2 = 'admin')`;
            checkParams.push(userId);
        }

        const orderRes = await client.query(checkQuery, checkParams);
        if (orderRes.rows.length === 0) {
            await client.query('COMMIT');
            return { success: true, message: 'Order not found or already removed' };
        }

        const order = orderRes.rows[0];

        // Safety check: Never delete a paid order or COD order
        if (order.payment_status === 'Paid' || order.payment_type === 'Paid' || order.payment_method === 'cod') {
            await client.query('ROLLBACK');
            throw new Error('Cannot delete a confirmed or paid order');
        }

        // 1. Restore product stock
        const itemsRes = await client.query(
            `SELECT product_id, quantity FROM order_items WHERE order_id = $1::uuid`,
            [orderId]
        );

        for (const item of itemsRes.rows) {
            const prodId = parseInt(item.product_id, 10);
            const qty = parseInt(item.quantity, 10);
            if (!isNaN(prodId) && !isNaN(qty) && qty > 0) {
                await client.query(
                    `UPDATE products
                     SET stock_quantity = stock_quantity + $2,
                         quantity       = quantity + $2,
                         instock        = true,
                         updated_at     = NOW()
                     WHERE product_id = $1::integer`,
                    [prodId, qty]
                );
            }
        }

        // 2. Restore coupon if used
        if (order.coupon_code) {
            try {
                await couponService.restoreCouponUsage(client, order.coupon_code, order.coupon_id, order.user_id);
            } catch (cErr) {
                console.warn('[OrderService] Could not restore coupon for abandoned order:', cErr.message);
            }
        }

        // 3. Delete order items
        await client.query(`DELETE FROM order_items WHERE order_id = $1::uuid`, [orderId]);

        // 4. Delete transactions (if any)
        await client.query(`DELETE FROM transactions WHERE order_id = $1::uuid`, [orderId]);

        // 5. Delete order record
        await client.query(`DELETE FROM orders WHERE id = $1::uuid`, [orderId]);

        await client.query('COMMIT');
        console.log(`[OrderService] Successfully deleted abandoned unpaid order: ${orderId}`);
        return { success: true, message: 'Abandoned order deleted and stock restored' };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[OrderService] Error deleting abandoned order:', error);
        throw error;
    } finally {
        client.release();
    }
};

exports.updateOrderStatus = async (orderId, status, cancelReason = null, bankDetails = null, paymentStatus = null, itemIds = null, cancelledBy = null, trackingNumber = null, reverseTrackingNumber = null) => {
    // QA outcomes must go through recordQaInspection (handles refund gating / -REP creation)
    if (QA_STATUSES.includes(status)) {
        const err = new Error('QA results must be recorded via the QA inspection action.');
        err.statusCode = 400;
        throw err;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get current status to check for cancellation
        const currentOrderRes = await client.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
        if (currentOrderRes.rows.length === 0) throw new Error('Order not found');

        const oldOrder = currentOrderRes.rows[0];
        const oldStatus = oldOrder.status;
        const oldIsProductReceived = oldOrder.is_product_received;

        // ── TERMINAL STATUS GUARD ──────────────────────────────────────────
        // Cancelled and Refunded orders are in a terminal state and cannot transition
        // to active fulfillment statuses (Delivered, Shipped, Out for Delivery, Confirmed, Processing).
        const TERMINAL_CANCELLED_STATUSES = ['Cancelled', 'Cancellation Requested', 'CANCEL_REQUESTED', 'Refunded'];
        if (['Delivered', 'Shipped', 'Out for Delivery', 'Confirmed', 'Processing'].includes(status) && TERMINAL_CANCELLED_STATUSES.includes(oldStatus)) {
            const err = new Error(`Cannot transition ${oldStatus} order #${oldOrder.order_number} to '${status}'. Cancelled or refunded orders cannot be fulfilled.`);
            err.statusCode = 400;
            throw err;
        }

        // If attempting to mark as Delivered, ensure there is at least one active (non-cancelled / non-returned) item
        if (status === 'Delivered') {
            const activeItemsRes = await client.query(
                `SELECT COUNT(*) as count FROM order_items WHERE order_id = $1::uuid AND (status IS NULL OR status NOT IN ('Cancelled', 'Return Approved', 'Returned', 'Refunded', 'Restocked'))`,
                [orderId]
            );
            if (parseInt(activeItemsRes.rows[0]?.count || 0) === 0) {
                const err = new Error(`Cannot mark order #${oldOrder.order_number} as Delivered because all items have been cancelled or returned.`);
                err.statusCode = 400;
                throw err;
            }
        }

        if (itemIds && Array.isArray(itemIds) && itemIds.length > 0 && typeof itemIds[0] === 'object') {
            console.log(`[OrderService] Partial update for Order ${orderId}: Items=${JSON.stringify(itemIds)}, Status=${status}`);

            for (const reqItem of itemIds) {
                const { id: itemId, quantity: cancelQty } = reqItem;

                // Fetch current item state (supporting both UUID and product ID)
                const isUuid = typeof itemId === 'string' && itemId.length === 36;
                let itemRes;
                if (isUuid) {
                    itemRes = await client.query(`SELECT * FROM order_items WHERE id = $1::uuid AND order_id = $2::uuid`, [itemId, orderId]);
                } else {
                    itemRes = await client.query(`SELECT * FROM order_items WHERE product_id = $1::integer AND order_id = $2::uuid`, [itemId, orderId]);
                }
                if (itemRes.rows.length === 0) continue;
                const originalItem = itemRes.rows[0];
                const dbItemId = originalItem.id; // This is a valid UUID!

                if (cancelQty > originalItem.quantity) throw new Error(`Cannot cancel more than purchased for ${originalItem.name}`);

                if (cancelQty < originalItem.quantity) {
                    // SPLIT ROW: Reduce original quantity using UUID
                    await client.query(`UPDATE order_items SET quantity = quantity - $1 WHERE id = $2::uuid`, [cancelQty, dbItemId]);

                    // INSERT new row with the requested status
                    await client.query(
                        `INSERT INTO order_items (
                            order_id, product_id, name, quantity, price, image, status, cancel_reason, created_at
                        ) VALUES ($1::uuid, $2::integer, $3::text, $4::integer, $5::numeric, $6::text, $7::text, $8::text, NOW())`,
                        [orderId, originalItem.product_id, originalItem.name, cancelQty, originalItem.price, originalItem.image, status, cancelReason]
                    );
                } else {
                    // FULL ROW: Just update status using UUID
                    await client.query(`UPDATE order_items SET status = $1::text, cancel_reason = $2::text WHERE id = $3::uuid`, [status, cancelReason, dbItemId]);
                }

                // Determine stock adjustment
                // If moving TO a cancelled state from a non-cancelled state -> Restore stock (+)
                // If moving FROM a cancelled state to a non-cancelled state -> Reduce stock (-)
                // Stock for RETURNED items is restored exactly once, when the parcel physically reaches the
                // warehouse ("Received at Homved", order-level inventory automation below). Approving a return /
                // moving through pickup stages must NOT touch stock, otherwise the unit is counted twice.
                // Only cancellations (item never left the warehouse) restore stock here.
                const returnCycleStatuses = ['Return Approved', 'Return Processing', ...RETURN_PICKUP_STAGES, 'Received at Homved', 'Return QA Passed', 'Return QA Failed'];
                const stockReturnedStatuses = ['Cancelled', 'CANCEL_APPROVED', 'Returned', 'Refunded'];
                const movingWithinReturnCycle = returnCycleStatuses.includes(status) || returnCycleStatuses.includes(originalItem.status);
                const isCancelling = !movingWithinReturnCycle && stockReturnedStatuses.includes(status);
                const wasCancelling = !movingWithinReturnCycle && stockReturnedStatuses.includes(originalItem.status);

                // Replacement dispatch: decrement product stock for the shipped replacement unit
                const isReplacementDispatch = (status === 'Replacement Shipped' || status === 'Replaced');
                const wasReplacementDispatch = (originalItem.status === 'Replacement Shipped' || originalItem.status === 'Replaced');

                let stockAdjustment = 0;
                if (isCancelling && !wasCancelling) {
                    stockAdjustment = cancelQty;
                } else if (!isCancelling && wasCancelling) {
                    stockAdjustment = -cancelQty;
                } else if (isReplacementDispatch && !wasReplacementDispatch) {
                    stockAdjustment = -cancelQty;
                }

                if (stockAdjustment !== 0) {
                    await client.query(
                        `UPDATE products 
                         SET stock_quantity = stock_quantity + $2,
                             quantity = quantity + $2,
                             instock = (CASE WHEN stock_quantity + $2 > 0 THEN true ELSE instock END),
                             updated_at = NOW()
                         WHERE product_id = $1::integer`,
                        [originalItem.product_id, stockAdjustment]
                    );
                }
            }

            // 3. Check if all items in the order are now cancelled
            const totalItemsResult = await client.query(`SELECT COUNT(*) FROM order_items WHERE order_id = $1::uuid`, [orderId]);
            const cancelledItemsResult = await client.query(`SELECT COUNT(*) FROM order_items WHERE order_id = $1::uuid AND status = 'Cancelled'`, [orderId]);

            const totalCount = parseInt(totalItemsResult.rows[0].count);
            const cancelledCount = parseInt(cancelledItemsResult.rows[0].count);

            if (cancelledCount === totalCount) {
                // All items cancelled -> update main order to status
                status = 'Cancelled';
                await client.query(
                    `UPDATE orders 
                     SET status = $2::text, 
                         cancel_reason = CASE 
                             WHEN $3::text IS NOT NULL AND $3::text <> '' THEN $3::text 
                             ELSE COALESCE(cancel_reason, 'Not specified') 
                         END,
                         cancelled_by = COALESCE($9::text, cancelled_by),
                         original_status = COALESCE(original_status, $4::text), 
                         cancelled_at = NOW(), 
                         updated_at = NOW(),
                         refund_eligible_amount = CASE 
                             WHEN status IN ('Cancelled', 'Cancellation Requested', 'CANCEL_REQUESTED') THEN COALESCE(refund_eligible_amount, 0)
                             ELSE COALESCE(refund_eligible_amount, 0) + total
                         END,
                         refund_bank_account = COALESCE($5::text, refund_bank_account),
                         refund_ifsc_code = COALESCE($6::text, refund_ifsc_code),
                         refund_holder_name = COALESCE($7::text, refund_holder_name),
                         refund_status = CASE 
                             WHEN LOWER(payment_method) = 'cod' THEN NULL 
                             WHEN COALESCE($8::text, payment_status) IN ('Failed', 'Cancelled') THEN NULL
                             WHEN payment_status NOT IN ('Paid', 'Completed') AND COALESCE($8::text, payment_status) NOT IN ('Paid', 'Completed') THEN NULL
                             ELSE COALESCE(refund_status, 'Pending') 
                         END,
                         payment_status = CASE
                             WHEN COALESCE($8::text, payment_status) IN ('Failed', 'Cancelled') THEN COALESCE($8::text, payment_status)
                             WHEN LOWER(payment_method) != 'cod' AND payment_status NOT IN ('Paid', 'Completed') THEN 'Failed'
                             ELSE COALESCE($8::text, payment_status)
                         END
                     WHERE id = $1::uuid`,
                    [
                        orderId,
                        status,
                        cancelReason || null,
                        oldStatus || null,
                        bankDetails?.accountNumber || null,
                        bankDetails?.ifscCode || null,
                        bankDetails?.holderName || null,
                        paymentStatus || null,
                        cancelledBy || null
                    ]
                );

                // Restore coupon usage limit & assignment if order used a coupon
                if (oldOrder.coupon_code && oldStatus !== 'Cancelled') {
                    await couponService.restoreCouponUsage(client, oldOrder.coupon_code, oldOrder.coupon_id, oldOrder.user_id);
                }

                await client.query('COMMIT');
                return await exports.getOrderById(orderId);
            } else {
                // Calculate new subtotal for remaining active items
                const subtotalResult = await client.query(
                    `SELECT SUM(price * quantity) as new_subtotal FROM order_items WHERE order_id = $1::uuid AND (status IS NULL OR status NOT IN ('Cancelled', 'Return Approved', 'Return Processing', 'Return Collected', 'Received at Homved', 'Returned', 'Refunded', 'Restocked'))`,
                    [orderId]
                );
                const newSubtotal = parseFloat(subtotalResult.rows[0].new_subtotal || 0);

                // ── DISCOUNT ON LAST PRODUCT RULE ─────────────────────────────
                // The coupon discount is NOT split proportionally across cancelled items.
                // Instead, the discount stays attached to the remaining active items.
                // Only when the remaining subtotal drops below the discount amount does
                // any excess discount get deducted from the refund value.
                // This ensures earlier cancellations are refunded at full item price.
                const originalOrderSubtotal = parseFloat(oldOrder.initial_subtotal || oldOrder.subtotal || 0);
                const originalOrderTotal = parseFloat(oldOrder.original_total || oldOrder.total || 0);

                const cancelledSubtotal = Math.max(0, parseFloat(oldOrder.subtotal) - newSubtotal);
                const originalDiscount = parseFloat(oldOrder.discount_amount || 0);

                // How much discount can the remaining items still absorb?
                // If remaining subtotal >= discount, all discount stays on remaining items → refund full cancelled amount.
                // If remaining subtotal < discount, the excess spills into the refund deduction.
                const discountAbsorbedByRemaining = Math.min(originalDiscount, newSubtotal);
                const newDiscountAmount = (newSubtotal > 0) ? discountAbsorbedByRemaining : originalDiscount;
                const discountSpillIntoRefund = Math.max(0, originalDiscount - discountAbsorbedByRemaining);
                const refundValue = Math.max(0, cancelledSubtotal - discountSpillIntoRefund);

                // If remaining active items subtotal is 0 (all items cancelled/returned),
                // preserve the original subtotal and total so the order record never displays ₹0.00!
                const finalOrderSubtotal = (newSubtotal > 0) ? newSubtotal : originalOrderSubtotal;
                const finalOrderTotal = (newSubtotal > 0) 
                    ? Math.max(0, newSubtotal + parseFloat(oldOrder.shipping || 0) - discountAbsorbedByRemaining) 
                    : originalOrderTotal;

                // Update order with new subtotal, discount, and re-calculate total
                await client.query(
                    `UPDATE orders SET 
                        initial_subtotal = COALESCE(initial_subtotal, subtotal),
                        original_total = COALESCE(original_total, total),
                        subtotal = $2::numeric,
                        discount_amount = $10::numeric,
                        total = $11::numeric,
                        refund_eligible_amount = COALESCE(refund_eligible_amount, 0) + $9::numeric,
                        status = CASE 
                            WHEN $7::text = 'Cancelled' THEN 
                                CASE 
                                    WHEN status = 'Cancellation Requested' THEN COALESCE(original_status, 'Confirmed')
                                    ELSE status 
                                END
                            WHEN $7::text = 'Cancellation Requested' THEN 'Cancellation Requested'
                            WHEN status = 'Cancellation Requested' THEN $7::text
                            WHEN $7::text IN (
                                'Return Request Processing', 'Return Approved', 'Return Processing', 
                                'Return Collected', 'Received at Homved', 'Returned', 'Refunded', 'Restocked', 
                                'Return Rejected', 'Return/Replace Pending',
                                'Replace Requested', 'Replacement Request Processing', 'Replace Approved', 'Replace Rejected',
                                'Replacement Processing', 'Replacement Shipped', 'Replacement Out for Delivery',
                                'Delivered', 'Replaced',
                                'Return Pickup Scheduled', 'Return Out for Pickup', 'Return In Transit',
                                'Replace Pickup Scheduled', 'Replace Out for Pickup', 'Replace Collected', 'Replace In Transit'
                            ) THEN $7::text
                            ELSE status
                        END,
                        original_status = CASE 
                            WHEN $7::text = 'Cancellation Requested' THEN COALESCE(original_status, status)
                            WHEN $7::text = 'Cancelled' THEN COALESCE(original_status, status)
                            WHEN status = 'Cancellation Requested' THEN NULL
                            ELSE original_status
                        END,
                        cancel_reason = CASE 
                            WHEN $8::text IS NOT NULL AND $8::text <> '' THEN $8::text 
                            ELSE COALESCE(cancel_reason, 'Not specified') 
                        END,
                        refund_bank_account = COALESCE($3::text, refund_bank_account),
                        refund_ifsc_code = COALESCE($4::text, refund_ifsc_code),
                        refund_holder_name = COALESCE($5::text, refund_holder_name),
                        refund_status = $6::text,
                        payment_status = CASE 
                            WHEN $7::text = 'Delivered' AND LOWER(payment_method) = 'cod' AND payment_status NOT IN ('Refunded', 'Cancelled') THEN 'Paid'
                            ELSE payment_status
                        END,
                        payment_type = CASE 
                            WHEN $7::text = 'Delivered' AND LOWER(payment_method) = 'cod' THEN 'Paid'
                            ELSE payment_type
                        END,
                        delivered_at = CASE 
                            WHEN $7::text = 'Delivered' AND delivered_at IS NULL THEN NOW() 
                            ELSE delivered_at 
                        END,
                        updated_at = NOW()
                     WHERE id = $1::uuid`,
                    [
                        orderId,                                                                    // $1
                        finalOrderSubtotal,                                                         // $2
                        bankDetails?.accountNumber || null,                                         // $3
                        bankDetails?.ifscCode || null,                                              // $4
                        bankDetails?.holderName || null,                                            // $5
                        (oldOrder.payment_method?.toLowerCase() !== 'cod' || oldOrder.is_returned_order || (status && status.toLowerCase().includes('return'))) ? 'Pending' : (oldOrder.refund_status || null), // $6
                        status,                                                                     // $7
                        cancelReason || null,                                                       // $8
                        refundValue,                                                                // $9
                        newDiscountAmount,                                                          // $10
                        finalOrderTotal                                                             // $11
                    ]
                );

                await client.query('COMMIT');
                return await exports.getOrderById(orderId);
            }
        }

        // Update status
        let updateQuery;
        let updateParams;

        if (status === 'Cancelled' || status === 'Cancellation Requested' || status === 'CANCEL_REQUESTED') {
            updateQuery = `UPDATE orders 
                           SET status = $2::text, 
                               cancel_reason = CASE 
                                   WHEN $3::text IS NOT NULL AND $3::text <> '' THEN $3::text 
                                   ELSE COALESCE(cancel_reason, 'Not specified') 
                               END,
                               cancelled_by = COALESCE($9::text, cancelled_by),
                               original_status = COALESCE(original_status, $4::text), 
                               cancelled_at = NOW(), 
                               updated_at = NOW(),
                               refund_eligible_amount = CASE 
                                   WHEN status IN ('Cancelled', 'Cancellation Requested', 'CANCEL_REQUESTED') THEN COALESCE(refund_eligible_amount, 0)
                                   ELSE COALESCE(refund_eligible_amount, 0) + total
                               END,
                               refund_bank_account = COALESCE($5::text, refund_bank_account),
                               refund_ifsc_code = COALESCE($6::text, refund_ifsc_code),
                               refund_holder_name = COALESCE($7::text, refund_holder_name),
                               refund_status = CASE 
                                   WHEN LOWER(payment_method) = 'cod' THEN NULL 
                                   WHEN COALESCE($8::text, payment_status) IN ('Failed', 'Cancelled') THEN NULL
                                   WHEN payment_status NOT IN ('Paid', 'Completed') AND COALESCE($8::text, payment_status) NOT IN ('Paid', 'Completed') THEN NULL
                                   ELSE COALESCE(refund_status, 'Pending') 
                               END,
                               payment_status = CASE
                                   WHEN COALESCE($8::text, payment_status) IN ('Failed', 'Cancelled') THEN COALESCE($8::text, payment_status)
                                   WHEN LOWER(payment_method) != 'cod' AND payment_status NOT IN ('Paid', 'Completed') THEN 'Failed'
                                   ELSE COALESCE($8::text, payment_status)
                               END
                           WHERE id = $1::uuid RETURNING *`;
            updateParams = [
                orderId,
                status,
                cancelReason || null,
                oldStatus || null,
                bankDetails?.accountNumber || null,
                bankDetails?.ifscCode || null,
                bankDetails?.holderName || null,
                paymentStatus || null,
                cancelledBy || null
            ];
        } else if (status === 'Delivered') {
            const isCOD = (oldOrder.payment_method || '').toLowerCase() === 'cod';
            // Only automatically flip payment_status to 'Paid' for COD deliveries on active orders.
            // For online/prepaid orders, delivery does NOT make an unpaid transaction Paid.
            let resolvedPaymentStatus;
            if (isCOD) {
                resolvedPaymentStatus = !['Refunded', 'Cancelled'].includes(oldOrder.payment_status) ? 'Paid' : oldOrder.payment_status;
            } else {
                resolvedPaymentStatus = (paymentStatus && paymentStatus !== 'Paid') ? paymentStatus : oldOrder.payment_status;
            }
            const resolvedPaymentType = isCOD ? 'Paid' : (resolvedPaymentStatus === 'Paid' ? 'Paid' : oldOrder.payment_type);
            console.log(`[OrderService] Marking order ${orderId} as Delivered. PaymentStatus: ${resolvedPaymentStatus}, PaymentType: ${resolvedPaymentType}`);
            updateQuery = `UPDATE orders SET status = $2, original_status = $2, logistics_status = 'Delivered', payment_status = $3, payment_type = $4, delivered_at = COALESCE(delivered_at, NOW()), updated_at = NOW() WHERE id = $1 RETURNING *`;
            updateParams = [orderId, status, resolvedPaymentStatus, resolvedPaymentType];
        } else if (status.includes('Return Approved') || status.includes('Return Rejected') ||
            status.includes('Replace Approved') || status.includes('Replace Rejected') ||
            status === 'Received at Homved' || status === 'Refunded' || status === 'Replaced' ||
            status === 'Returned' || status === 'Return Processing') {

            const isRejected = status.includes('Rejected') || status.includes('Un-Approved');
            const isApproved = status.includes('Approved');

            // Pre-calculate values to avoid complex CASE statements in SQL
            let refundStatusVal = oldOrder.refund_status;
            if (oldOrder.payment_status === 'Refunded') {
                if (!['Refunded', 'Completed'].includes(refundStatusVal)) {
                    refundStatusVal = 'Refunded';
                }
            } else if (status === 'Return Approved' || status === 'Returned') {
                refundStatusVal = oldOrder.refund_status || 'Pending';
            } else if (status === 'Refunded') {
                refundStatusVal = 'Refunded';
            }

            const productReceivedVal = (status === 'Received at Homved' || status === 'Returned') ? true : oldIsProductReceived;
            const logisticsStatusVal = (status === 'Received at Homved' || status === 'Returned') ? 'Received at Homved' : oldOrder.logistics_status;

            // PARTIAL UPDATE: If itemIds are provided, update those specific items
            if (itemIds && itemIds.length > 0) {
                console.log(`[OrderService] Partial Return/Replace update for order ${orderId}, items: ${JSON.stringify(itemIds)}, newStatus: ${status}`);
                const idsToUpdate = itemIds.map(i => typeof i === 'string' ? i : i.id);
                await client.query(
                    `UPDATE order_items 
                     SET status = $2
                     WHERE order_id = $1::uuid AND id = ANY($3::uuid[])`,
                    [orderId, status, idsToUpdate]
                );

                // If some items were rejected, maybe show that in the order
                if (isRejected) {
                    await client.query(
                        `UPDATE orders SET rejection_reason = $2, updated_at = NOW() WHERE id = $1`,
                        [orderId, cancelReason || 'Administrative decision']
                    );
                }
            }

            // Determine if the main order status should actually change
            let finalStatus = status;
            if (itemIds && itemIds.length > 0) {
                const allItemsRes = await client.query('SELECT status FROM order_items WHERE order_id = $1', [orderId]);
                finalStatus = resolveParentOrderStatus(allItemsRes.rows, oldOrder.status);
            }

            updateQuery = `UPDATE orders SET 
                           status = $2::text, 
                           rejection_reason = COALESCE($3::text, rejection_reason),
                           refund_status = $4::text,
                           is_product_received = $5::boolean,
                           logistics_status = $6::text,
                           is_returned_order = CASE WHEN $2::text IN ('Return Approved', 'Returned', 'Received at Homved', 'Return Processing') THEN TRUE ELSE is_returned_order END,
                           payment_status = CASE 
                                              WHEN $2::text = 'Refunded' THEN 'Refunded'
                                              WHEN $7::text IS NOT NULL THEN $7::text
                                              ELSE payment_status 
                                            END,
                           updated_at = NOW() 
                           WHERE id = $1::uuid RETURNING *`;
            updateParams = [
                orderId,
                finalStatus,
                isRejected ? (cancelReason || 'Administrative decision') : null,
                refundStatusVal,
                productReceivedVal,
                logisticsStatusVal,
                paymentStatus || null
            ];

            if (status === 'Replace Approved') {
                // Fetch the full order details to create a replacement
                const orderToReplace = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
                const originalOrder = orderToReplace.rows[0];

                if (originalOrder) {
                    // Filter items that are actually being replaced
                    let itemsToReplace = [];
                    if (itemIds && itemIds.length > 0) {
                        const ids = itemIds.map(i => i.id);
                        const isUuid = typeof ids[0] === 'string' && ids[0].length === 36;
                        const itemsResult = await client.query(`SELECT * FROM order_items WHERE order_id = $1 AND id = ANY($2::${isUuid ? 'uuid' : 'integer'}[])`, [orderId, ids]);
                        itemsToReplace = itemsResult.rows;
                    } else {
                        const itemsResult = await client.query('SELECT * FROM order_items WHERE order_id = $1 AND (status LIKE \'%Replace Requested%\' OR status LIKE \'%Request Processing%\')', [orderId]);
                        itemsToReplace = itemsResult.rows;
                    }

                    // We no longer create a double $0.00 order record.
                    // The replacement journey will be tracked on the original order.
                }

                // Mark items in ORIGINAL order as 'Replace Approved'
                const ids = (itemIds && itemIds.length > 0) ? itemIds.map(i => i.id) : [];
                const isUuid = ids.length > 0 && typeof ids[0] === 'string' && ids[0].length === 36;
                const whereClause = (itemIds && itemIds.length > 0) ? `order_id = $1 AND id = ANY($2::${isUuid ? 'uuid' : 'integer'}[])` : `order_id = $1 AND (status LIKE '%Replace Requested%' OR status LIKE '%Request Processing%')`;
                const params = (itemIds && itemIds.length > 0) ? [orderId, ids] : [orderId];
                await client.query(`UPDATE order_items SET status = 'Replace Approved' WHERE ${whereClause}`, params);
            }
        } else if (RETURN_PICKUP_STAGES.includes(status) || REPLACE_PICKUP_STAGES.includes(status) || REPLACEMENT_DELIVERY_STAGES.includes(status)) {
            // ── Reverse logistics stage update (parcel collection / replacement dispatch) ──
            // Moves the order and its in-cycle items forward without touching original_status.
            const isReturnStage = RETURN_PICKUP_STAGES.includes(status);

            // "Pickup Scheduled" = book the DTDC reverse pickup (customer → Homved) right now.
            // Idempotent: reuses the existing reverse AWB if one was already booked.
            // If DTDC rejects the booking, the stage change is aborted so the journey never claims
            // a pickup that doesn't exist.
            if ((status === 'Return Pickup Scheduled' || status === 'Replace Pickup Scheduled') && !oldOrder.reverse_tracking_id) {
                try {
                    const reverse = await dtdcService.createReverseShipment(orderId);
                    console.log(`[OrderService] Reverse pickup booked for ${oldOrder.order_number}: ${reverse.reverseTrackingNumber}`);
                } catch (bookingErr) {
                    console.warn(`[OrderService] DTDC reverse booking warning (${bookingErr.message}). Assigning fallback reverse tracking.`);
                    const fallbackAwb = `REV-DTDC-${(oldOrder.order_number || orderId).replace(/^#/, '')}`;
                    await client.query(
                        `UPDATE orders SET reverse_tracking_id = $1, logistics_provider = 'DTDC', logistics_status = $2, updated_at = NOW() WHERE id = $3`,
                        [fallbackAwb, status, orderId]
                    );
                }
            }

            const cycleStatuses = isReturnStage ? [...RETURN_CYCLE_ITEM_STATUSES] : [...REPLACE_CYCLE_ITEM_STATUSES];
            if (!isReturnStage && oldStatus === 'Received at Homved') {
                cycleStatuses.push('Received at Homved');
            }

            await client.query(
                `UPDATE order_items SET status = $2::text
                 WHERE order_id = $1::uuid AND status = ANY($3::text[])`,
                [orderId, status, cycleStatuses]
            );

            updateQuery = `UPDATE orders SET
                           status = $2::text,
                           logistics_status = $2::text,
                           is_returned_order = CASE WHEN $3::boolean THEN TRUE ELSE is_returned_order END,
                           refund_status = CASE WHEN $3::boolean THEN COALESCE(refund_status, 'Pending') ELSE refund_status END,
                           updated_at = NOW()
                           WHERE id = $1::uuid RETURNING *`;
            updateParams = [orderId, status, isReturnStage];
        } else if (status === 'Restore') {
            const restoredStatus = oldOrder.original_status || 'Confirmed';
            console.log(`[OrderService] Restoring order ${orderId} to original status: ${restoredStatus}`);

            // Revert requested items back to original status too
            await client.query(`
                UPDATE order_items 
                SET status = $2::text 
                WHERE order_id = $1::uuid 
                AND status IN ('Return Requested', 'Replace Requested', 'Cancellation Requested', 'CANCEL_REQUESTED', 'CANCEL_APPROVED', 'Return Request Processing', 'Replacement Request Processing')
            `, [orderId, restoredStatus]);

            updateQuery = `UPDATE orders SET 
                           status = $2::text,
                           rejection_reason = $3::text,
                           updated_at = NOW() 
                           WHERE id = $1::uuid RETURNING *`;
            updateParams = [orderId, restoredStatus, cancelReason || 'Request rejected by Admin'];

            // Update local status variable so syncableStatuses logic below doesn't get confused
            status = restoredStatus;
        } else {
            updateQuery = `UPDATE orders SET 
                           status = $2::text, 
                           original_status = CASE 
                                              WHEN $2::text NOT IN ('Cancelled', 'Cancellation Requested', 'CANCEL_REQUESTED', 'Return Approved', 'Returned', 'Refunded', 'Received at Homved') THEN $2::text 
                                              ELSE original_status 
                                            END,
                           payment_status = CASE 
                                            WHEN $2::text = 'Delivered' AND LOWER(payment_method) = 'cod' AND payment_status NOT IN ('Refunded', 'Cancelled') THEN 'Paid'
                                            WHEN $2::text = 'Refunded' THEN 'Refunded'
                                            WHEN $3::text IS NOT NULL AND ($2::text != 'Delivered' OR LOWER(payment_method) = 'cod') THEN $3::text
                                            ELSE payment_status 
                                          END,
                           payment_type = CASE 
                                          WHEN $2::text = 'Delivered' AND LOWER(payment_method) = 'cod' THEN 'Paid'
                                          ELSE payment_type 
                                        END,
                           delivered_at = CASE 
                                          WHEN $2::text = 'Delivered' AND delivered_at IS NULL THEN NOW() 
                                          ELSE delivered_at 
                                        END,
                           is_returned_order = CASE WHEN $2::text IN ('Returned', 'Return Approved', 'Received at Homved', 'Return Request Processing', 'Return Requested', 'Partially Returning', 'Return Processing', 'Return Collected') THEN TRUE ELSE is_returned_order END,
                           refund_status = CASE WHEN $2::text IN ('Returned', 'Return Approved', 'Return Request Processing', 'Return Requested', 'Partially Returning', 'Return Processing', 'Return Collected') THEN COALESCE(refund_status, 'Pending') ELSE refund_status END,
                           is_product_received = CASE WHEN $2::text IN ('Received at Homved', 'Returned') THEN TRUE ELSE is_product_received END,
                           logistics_status = CASE WHEN $2::text IN ('Received at Homved', 'Returned') THEN 'Received at Homved' WHEN $2::text IN ('Shipped', 'Out for Delivery', 'Delivered') THEN $2::text ELSE logistics_status END,
                           updated_at = NOW() WHERE id = $1::uuid RETURNING *`;
            updateParams = [orderId, status, paymentStatus];
        }

        const updateResult = await client.query(updateQuery, updateParams);

        // Fallback for Return/Replace item statuses when itemIds is NOT provided
        if (!itemIds || itemIds.length === 0) {
            if (status === 'Return Approved') {
                await client.query(
                    `UPDATE order_items 
                     SET status = 'Return Approved' 
                     WHERE order_id = $1 AND (status = 'Return Request Processing' OR status = 'Return Requested')`,
                    [orderId]
                );
            } else if (status === 'Return Rejected') {
                await client.query(
                    `UPDATE order_items 
                     SET status = 'Return Rejected' 
                     WHERE order_id = $1 AND (status = 'Return Request Processing' OR status = 'Return Requested')`,
                    [orderId]
                );
            } else if (status === 'Replace Rejected') {
                await client.query(
                    `UPDATE order_items 
                     SET status = 'Replace Rejected' 
                     WHERE order_id = $1 AND (status = 'Replacement Request Processing' OR status = 'Replace Requested')`,
                    [orderId]
                );
            } else if (status === 'Received at Homved') {
                await client.query(
                    `UPDATE order_items
                     SET status = 'Received at Homved'
                     WHERE order_id = $1 AND (status = 'Return Approved' OR status = 'Return Request Processing' OR status = 'Return Requested'
                        OR status = ANY($2::text[]))`,
                    [orderId, [...RETURN_PICKUP_STAGES, 'Return Processing', 'Replace Approved', ...REPLACE_PICKUP_STAGES]]
                );
            } else if (status === 'Refunded') {
                await client.query(
                    `UPDATE order_items
                     SET status = 'Refunded'
                     WHERE order_id = $1 AND (status = 'Return Approved' OR status = 'Received at Homved' OR status = 'Return Request Processing' OR status = 'Return Requested'
                        OR status = ANY($2::text[]))`,
                    [orderId, [...RETURN_PICKUP_STAGES, 'Return Processing', 'Return QA Passed']]
                );
            } else if (status === 'Replaced' || (status === 'Delivered' && (oldOrder.return_type === 'Replace' || (oldOrder.status && oldOrder.status.includes('Replace'))))) {
                await client.query(
                    `UPDATE order_items
                     SET status = 'Replaced'
                     WHERE order_id = $1 AND (status = ANY($2::text[]) OR status ILIKE '%replace%' OR status = 'Received at Homved')`,
                    [orderId, [...REPLACE_CYCLE_ITEM_STATUSES, 'Received at Homved']]
                );
            } else if (status === 'Returned') {
                await client.query(
                    `UPDATE order_items 
                     SET status = 'Returned' 
                     WHERE order_id = $1 AND (status = 'Return Approved' OR status = 'Received at Homved' OR status = 'Return Request Processing' OR status = 'Return Requested' OR status = 'Delivered')`,
                    [orderId]
                );
            }
        }

        // ── SYNC CHILD REPLACEMENT ORDER (-REP) TO PARENT ORDER ────────────────
        const isRepChildOrder = oldOrder.is_replacement === true || (oldOrder.order_number && oldOrder.order_number.endsWith('-REP'));
        const targetParentOrderId = oldOrder.parent_order_id || oldOrder.original_order_id;
        if (isRepChildOrder && targetParentOrderId) {
            if (status === 'Delivered') {
                console.log(`[OrderSync] Replacement order ${orderId} delivered. Syncing parent order ${targetParentOrderId} to Replaced.`);
                await client.query(
                    `UPDATE order_items 
                     SET status = 'Replaced' 
                     WHERE order_id = $1::uuid 
                       AND (status ILIKE '%replace%' OR status = 'Received at Homved' OR status = 'Delivered')`,
                    [targetParentOrderId]
                );
                const parentItemsRes = await client.query('SELECT * FROM order_items WHERE order_id = $1::uuid', [targetParentOrderId]);
                const newParentStatus = resolveParentOrderStatus(parentItemsRes.rows, 'Replaced');
                await client.query(
                    `UPDATE orders 
                     SET status = $2::text, 
                         logistics_status = 'Delivered', 
                         delivered_at = COALESCE(delivered_at, NOW()), 
                         updated_at = NOW() 
                     WHERE id = $1::uuid`,
                    [targetParentOrderId, newParentStatus || 'Replaced']
                );
            } else if (status === 'Shipped') {
                await client.query(
                    `UPDATE orders SET status = 'Replacement Shipped', logistics_status = 'Shipped', updated_at = NOW() WHERE id = $1::uuid AND status NOT IN ('Replaced', 'Delivered')`,
                    [targetParentOrderId]
                );
                await client.query(
                    `UPDATE order_items SET status = 'Replacement Shipped' WHERE order_id = $1::uuid AND (status ILIKE '%replace%' OR status = 'Received at Homved') AND status != 'Replaced'`,
                    [targetParentOrderId]
                );
            } else if (status === 'Out for Delivery') {
                await client.query(
                    `UPDATE orders SET status = 'Replacement Out for Delivery', logistics_status = 'Out for Delivery', updated_at = NOW() WHERE id = $1::uuid AND status NOT IN ('Replaced', 'Delivered')`,
                    [targetParentOrderId]
                );
                await client.query(
                    `UPDATE order_items SET status = 'Replacement Out for Delivery' WHERE order_id = $1::uuid AND (status ILIKE '%replace%' OR status = 'Received at Homved') AND status != 'Replaced'`,
                    [targetParentOrderId]
                );
            }
        }

        // Sync all items to the same status if order status changed (standard delivery cycle sync)
        // EXCEPTION: Do not sync items that are 'Cancelled' or in a Return/Replace process
        const syncableStatuses = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Returned', 'Refunded'];
        const itemExcludedStatuses = [
            'Cancelled', 'Returned', 'Refunded', 
            'Cancellation Requested', 'CANCEL_REQUESTED', 'CANCEL_APPROVED', 'Cancellation Approved', 'Partially Cancelled',
            'Return Request Processing', 'Replacement Request Processing', 
            'Return Approved', 'Return Rejected', 'Replace Approved', 'Replace Rejected', 
            'Return Processing', 'Return Collected', 'Received at Homved', 'Restocked', 
            'Replacement Processing', 'Replacement Shipped', 'Replacement Out for Delivery', 'Replaced'
        ];

        if (syncableStatuses.includes(status) && (!itemIds || itemIds.length === 0)) {
            // Check if there are any active Cancelled/Return/Replacement items in this order
            const currentItemsRes = await client.query('SELECT id, status, cancel_reason FROM order_items WHERE order_id = $1', [orderId]);
            const currentOrderItems = currentItemsRes.rows;

            const hasSpecialItems = currentOrderItems.some(item => {
                const s = (item.status || '').toLowerCase();
                return s.includes('replace') || s.includes('return') || s.includes('cancel') || s.includes('refund');
            });

            if (hasSpecialItems) {
                // For orders with cancelled/return/replacement items, do NOT touch special items.
                // Only update non-cancelled, non-special items to forward status (e.g. Delivered).
                console.log(`[OrderSync] Order ${orderId} has special/cancelled items. Protecting special items during lifecycle sync to ${status}.`);
                await client.query(
                    `UPDATE order_items 
                     SET status = $1 
                     WHERE order_id = $2 
                       AND (status IS NULL OR (
                           LOWER(status) NOT LIKE '%cancel%' 
                           AND (LOWER(status) NOT LIKE '%return%' OR LOWER(status) LIKE '%reject%' OR LOWER(status) LIKE '%denied%')
                           AND (LOWER(status) NOT LIKE '%replace%' OR LOWER(status) LIKE '%reject%' OR LOWER(status) LIKE '%denied%')
                           AND LOWER(status) NOT LIKE '%refund%'
                           AND (cancel_reason IS NULL OR cancel_reason = 'Not specified' OR cancel_reason = '')
                           AND status NOT IN (SELECT unnest($3::text[]))
                       ))`,
                    [status, orderId, itemExcludedStatuses]
                );
            } else {
                // Standard Lifecycle-aware sync for normal orders
                const lifecycle = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered'];
                const targetIndex = lifecycle.indexOf(status);

                const effectiveExcluded = [...itemExcludedStatuses];
                if (targetIndex !== -1) {
                    lifecycle.forEach((s, idx) => {
                        if (idx >= targetIndex && !effectiveExcluded.includes(s)) {
                            effectiveExcluded.push(s);
                        }
                    });
                }

                await client.query(
                    `UPDATE order_items 
                     SET status = $1 
                     WHERE order_id = $2 
                       AND (status IS NULL OR (
                           LOWER(status) NOT LIKE '%cancel%' 
                           AND (LOWER(status) NOT LIKE '%return%' OR LOWER(status) LIKE '%reject%' OR LOWER(status) LIKE '%denied%')
                           AND (LOWER(status) NOT LIKE '%replace%' OR LOWER(status) LIKE '%reject%' OR LOWER(status) LIKE '%denied%')
                           AND LOWER(status) NOT LIKE '%refund%'
                           AND (cancel_reason IS NULL OR cancel_reason = 'Not specified' OR cancel_reason = '')
                           AND status NOT IN (SELECT unnest($3::text[]))
                       ))`,
                    [status, orderId, effectiveExcluded]
                );
            }
        }

        const order = await exports.getOrderById(orderId);

        // ── LOGISTICS & NOTIFICATIONS (HOMVED-RR-05, HOMVED-RR-08) ────────
        if (status === 'Return Approved' || status === 'Replace Approved' || status === 'Cancelled' || status === 'Refunded') {
            try {
                // For Return/Replace, we need to know which items
                let affectedItems = [];
                if (itemIds && itemIds.length > 0) {
                    const ids = itemIds.map(i => i.id);
                    const isUuid = typeof ids[0] === 'string' && ids[0].length === 36;
                    let itemsRes;
                    if (isUuid) {
                        itemsRes = await client.query(
                            `SELECT * FROM order_items WHERE order_id = $1::uuid AND id = ANY($2::uuid[])`,
                            [orderId, ids]
                        );
                    } else {
                        itemsRes = await client.query(
                            `SELECT * FROM order_items WHERE order_id = $1::uuid AND product_id = ANY($2::integer[])`,
                            [orderId, ids]
                        );
                    }
                    affectedItems = itemsRes.rows;
                }

                // 1. Logistics: Only for Return/Replace Approval (Reverse Pickup)
                if ((status === 'Return Approved' || status === 'Replace Approved') && affectedItems.length > 0) {
                    await dtdcService.createReverseShipment(orderId);
                }

                // 2. Notifications: For all major lifecycle changes
                await whatsappService.sendOrderUpdateNotification(order, status);

            } catch (triggerError) {
                console.error('[TRIGGER ERROR] Background automation failed:', triggerError.message);
                // Non-blocking error
            }
        }

        // INVENTORY AUTOMATION (Common for All Methods)
        // Triggered SPECIFICALLY when status changes to 'Received at Homved' (Or finalized online)
        // As per HOMVED-014: "Product quantities must auto-increment specifically when status is 'Received at Homved'"
        const isReceivedAtHomved = status === 'Received at Homved';
        const isOnlineFinalization = ['Refunded', 'Returned'].includes(status);

        // Replacement parcels are not restocked on receipt (the defective unit goes to QA, not back on sale)
        const isReplaceCycleOrder = oldOrder.return_type === 'Replace' || (oldStatus || '').startsWith('Replace');
        if ((isReceivedAtHomved || isOnlineFinalization) && !oldIsProductReceived && !isReplaceCycleOrder) {
            // Multi-item orders: restore stock ONLY for the items that actually came back.
            // Items the customer kept (Delivered), cancelled items (already restocked on cancel) and
            // replacement items must not be touched.
            const itemsResult = await client.query(
                `SELECT product_id, quantity FROM order_items
                 WHERE order_id = $1 AND status IN ('Received at Homved', 'Returned', 'Refunded')`,
                [orderId]
            );
            console.log(`[INVENTORY AUTOMATION] Restoring stock for returned items of order ${orderId} (Status: ${status}). Items: ${itemsResult.rows.length}`);

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

        // ── IMMEDIATE INVENTORY RESTORATION FOR CANCELLATIONS ───────
        if (status === 'Cancelled') {
            if (itemIds && itemIds.length > 0) {
                console.log(`[INVENTORY AUTOMATION] Restoring stock for SPECIFIC cancelled items of order ${orderId}`);
                for (const item of itemIds) {
                    const isUuid = typeof item.id === 'string' && item.id.length === 36;
                    let targetProductRes;
                    if (isUuid) {
                        targetProductRes = await client.query(`SELECT product_id FROM order_items WHERE id = $1::uuid AND order_id = $2::uuid`, [item.id, orderId]);
                    } else {
                        targetProductRes = await client.query(`SELECT product_id FROM order_items WHERE product_id = $1::integer AND order_id = $2::uuid`, [item.id, orderId]);
                    }

                    if (targetProductRes.rows.length > 0) {
                        const prodId = targetProductRes.rows[0].product_id;
                        await client.query(
                            `UPDATE products 
                             SET stock_quantity = stock_quantity + $2,
                                 quantity = quantity + $2,
                                 instock = true,
                                 updated_at = NOW()
                             WHERE product_id = $1::integer`,
                            [prodId, item.quantity]
                        );
                    }
                }

                // Check if all items are now cancelled
                const remainingItems = await client.query(
                    `SELECT COUNT(*) FROM order_items WHERE order_id = $1 AND status != 'Cancelled'`,
                    [orderId]
                );

                // If some items remain, keep current order status (do not set to Partially Cancelled)
            } else if (oldOrder.status !== 'Cancelled') {
                console.log(`[INVENTORY AUTOMATION] Restoring stock for all active items of cancelled order ${orderId}`);
                const itemsResult = await client.query(
                    `SELECT product_id, quantity FROM order_items WHERE order_id = $1 AND (status IS NULL OR (status != 'Cancelled' AND status != 'Returned' AND status != 'Refunded'))`,
                    [orderId]
                );
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

                // Sync all order items to Cancelled
                await client.query(
                    `UPDATE order_items SET status = 'Cancelled' WHERE order_id = $1 AND (status IS NULL OR (status != 'Cancelled' AND status != 'Returned' AND status != 'Refunded'))`,
                    [orderId]
                );

                // Restore coupon usage limit & assignment if order used a coupon
                if (oldOrder.coupon_code) {
                    await couponService.restoreCouponUsage(client, oldOrder.coupon_code, oldOrder.coupon_id, oldOrder.user_id);
                }
            }
        }

        // If order was previously Cancelled and is being un-cancelled, re-consume coupon
        if (oldOrder.status === 'Cancelled' && status !== 'Cancelled' && status !== 'CANCEL_REQUESTED' && status !== 'Cancellation Requested') {
            if (oldOrder.coupon_code) {
                await couponService.consumeCouponUsage(client, oldOrder.coupon_code, oldOrder.coupon_id, oldOrder.user_id);
            }
        }

        // ── INVENTORY DECREMENT FOR REPLACEMENT DISPATCH (Order-Level) ────
        if (status === 'Replacement Shipped' && oldStatus !== 'Replacement Shipped' && (!itemIds || itemIds.length === 0)) {
            console.log(`[INVENTORY AUTOMATION] Decrementing stock for replacement dispatch of order ${orderId}`);
            const replaceItemsRes = await client.query(
                `SELECT product_id, quantity FROM order_items 
                 WHERE order_id = $1::uuid 
                 AND (status LIKE '%Replace%' OR status LIKE '%Replacement%')`,
                [orderId]
            );
            for (const rItem of replaceItemsRes.rows) {
                await client.query(
                    `UPDATE products 
                     SET stock_quantity = GREATEST(0, stock_quantity - $2),
                         quantity = GREATEST(0, quantity - $2),
                         instock = (CASE WHEN stock_quantity - $2 > 0 THEN true ELSE false END),
                         updated_at = NOW()
                     WHERE product_id = $1::integer`,
                    [rItem.product_id, rItem.quantity]
                );
            }
        }

        // ── UPDATE TRACKING NUMBER IF PROVIDED ──────────────────────────
        if (trackingNumber) {
            await client.query(
                `UPDATE orders SET tracking_number = $2::text, updated_at = NOW() WHERE id = $1::uuid`,
                [orderId, trackingNumber]
            );
        }

        if (reverseTrackingNumber) {
            await client.query(
                `UPDATE orders SET reverse_tracking_id = $2::text, updated_at = NOW() WHERE id = $1::uuid`,
                [orderId, reverseTrackingNumber]
            );
        }

        // ── AUTOMATED FINANCIAL REFUND (HOMVED-RR-07) ───────────────────
        // NOTE: Automated Razorpay refund on Return Approval was removed from here.
        // It has been moved to updateRefundStatus to process refunds through the Refund Desk.


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

        const orderQuery = await client.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
        if (orderQuery.rows.length === 0) throw new Error('Order not found');
        const oldOrder = orderQuery.rows[0];
        const isOnline = oldOrder.payment_method?.toLowerCase() !== 'cod';
        const oldIsProductReceived = oldOrder.is_product_received;

        // ── PAYMENT STATUS GUARD: Refund stage updates are strictly restricted to successfully paid orders ──
        const isPaymentFailedOrCancelled = ['Failed', 'Cancelled'].includes(oldOrder.payment_status);
        const isUnpaidOnline = isOnline && !['Paid', 'Completed', 'Refunded'].includes(oldOrder.payment_status);
        const isUnpaidCod = !isOnline && !['Paid', 'Completed', 'Refunded'].includes(oldOrder.payment_status) && !oldOrder.is_returned_order && oldOrder.status !== 'Delivered' && !oldOrder.status?.toLowerCase()?.includes('return');

        if (isPaymentFailedOrCancelled || isUnpaidOnline || isUnpaidCod) {
            const err = new Error(`Refund not applicable: Payment for order #${oldOrder.order_number} is marked as ${oldOrder.payment_status || 'Unpaid'}. Refund management is strictly restricted to successfully paid orders.`);
            err.statusCode = 400;
            throw err;
        }

        const transitioningToFinal = refundStatus === 'Completed' || refundStatus === 'Refunded';

        // ── QA gate: returned parcels must pass QA inspection before any refund is processed ──
        if ((transitioningToFinal || refundStatus === 'Processing') && REFUND_BLOCKED_UNTIL_QA.includes(oldOrder.status) && oldOrder.return_type !== 'Replace') {
            const reason = oldOrder.status === 'Return QA Failed'
                ? 'This return failed QA inspection, so it is not eligible for a refund.'
                : `Refund cannot be processed yet: the returned parcel must be received at Homved and pass QA inspection first (current status: "${oldOrder.status}").`;
            const err = new Error(reason);
            err.statusCode = 400;
            throw err;
        }

        let finalTxnId = txnId;

        if (isOnline && transitioningToFinal) {
            const hasRazorpay = !!oldOrder.razorpay_payment_id;
            const wantsAutoRefund = !txnId || txnId === 'AUTO' || txnId === 'Auto-Refund via Razorpay';

            if (wantsAutoRefund && !hasRazorpay) {
                // Fallback to manual transaction ID if no Razorpay payment ID is associated
                finalTxnId = 'RFND-MANUAL-' + Math.random().toString(36).substring(2, 10).toUpperCase();
                console.log(`[RefundDesk] No Razorpay payment ID associated with online order. Defaulting to manual transaction ID: ${finalTxnId}`);
            } else if (wantsAutoRefund) {

                // ── REFUND AMOUNT FOR RAZORPAY ───────────────────────────────────
                // Return orders: use exact product price (sum of return item prices, no discount deduction).
                // Cancellation orders: use stored refund_eligible_amount (discount-on-last-product rule).
                let refundAmount = 0;
                if (oldOrder.is_returned_order) {
                    // Return: sum of return item prices only — exact product value
                    const returnItemsRes = await client.query(
                        `SELECT ROUND(SUM(price * quantity), 2) as total
                         FROM order_items
                         WHERE order_id = $1
                           AND status IN ('Return Request Processing', 'Return Approved', 'Returned', 'Received at Homved', 'Refunded', 'Return Collected', 'Restocked')`,
                        [orderId]
                    );
                    refundAmount = parseFloat(returnItemsRes.rows[0]?.total || 0);
                } else {
                    // Cancellation: use stored refund_eligible_amount (discount-on-last-product formula)
                    refundAmount = parseFloat(oldOrder.refund_eligible_amount || 0);
                }
                if (refundAmount <= 0) {
                    refundAmount = parseFloat(oldOrder.total) || 0;
                }

                if (refundAmount > 0) {
                    console.log(`[RefundDesk] Triggering automated Razorpay refund for order ${orderId}, amount: ${refundAmount}`);
                    try {
                        const refundResult = await paymentService.refundPayment(oldOrder.razorpay_payment_id, refundAmount);
                        if (refundResult && refundResult.id) {
                            finalTxnId = refundResult.id;
                            console.log(`[RefundDesk] Razorpay refund initiated: ${finalTxnId}`);
                        } else {
                            // Razorpay not configured — treat as manual (admin will enter txn ID)
                            finalTxnId = txnId || null;
                            console.warn('[RefundDesk] Razorpay not configured, proceeding as manual refund.');
                        }
                    } catch (refundError) {
                        const errMsg = refundError?.message || JSON.stringify(refundError) || 'Unknown error';
                        console.error('[RefundDesk] Razorpay automated refund failed:', errMsg);
                        // Surface a clean error to the admin instead of crashing with "undefined"
                        throw new Error(`Razorpay refund failed: ${errMsg}`);
                    }
                } else {
                    throw new Error('Cannot process refund: Refund amount is 0.');
                }
            } else if (!txnId) {
                throw new Error('Transaction ID is mandatory for finalizing online refunds.');
            }
        } else if (!isOnline && transitioningToFinal) {
            // For COD orders, refund is completed via bank transfer / UPI.
            // If admin left Txn ID empty or AUTO, generate a clean reference ID.
            if (!finalTxnId || finalTxnId === 'AUTO') {
                finalTxnId = 'COD-REF-' + Math.random().toString(36).substring(2, 10).toUpperCase();
            }
        }

        // Whitelist valid refund statuses
        const validStatuses = ['Pending', 'In-Review', 'Processing', 'Refunded', 'Completed', 'Rejected', 'Denied', 'Restocked'];
        if (!refundStatus || !validStatuses.includes(refundStatus)) {
            throw new Error(`Invalid refund status: "${refundStatus}". Must be one of: ${validStatuses.join(', ')}.`);
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
                 payment_status = CASE 
                                     WHEN $2::text IN ('Completed', 'Refunded') AND NOT EXISTS (
                                         SELECT 1 FROM order_items 
                                         WHERE order_id = $1 
                                           AND (status IS NULL OR status NOT IN (
                                               'Cancelled', 'Cancellation Requested', 'CANCEL_REQUESTED', 'CANCEL_APPROVED',
                                               'Return Requested', 'Return Request Processing', 'Return Approved', 'Return Processing', 'Return Collected', 'Received at Homved', 'Returned', 'Refunded', 'Restocked', 'Return QA Passed', 'Replace QA Passed',
                                               'Replace Requested', 'Replacement Request Processing', 'Replace Approved', 'Replacement Processing', 'Replacement Shipped', 'Replacement Out for Delivery', 'Replaced'
                                           ))
                                     ) THEN 'Refunded'
                                     WHEN $2::text IN ('Completed', 'Refunded') THEN 'Paid'
                                     ELSE payment_status 
                                   END,
                 status = CASE 
                            WHEN $2::text IN ('Completed', 'Refunded', 'Success') AND NOT EXISTS (
                                SELECT 1 FROM order_items 
                                WHERE order_id = $1 
                                  AND (status IS NULL OR status NOT IN (
                                      'Cancelled', 'Cancellation Requested', 'CANCEL_REQUESTED', 'CANCEL_APPROVED',
                                      'Return Requested', 'Return Request Processing', 'Return Approved', 'Return Processing', 'Return Collected', 'Received at Homved', 'Returned', 'Refunded', 'Restocked', 'Return QA Passed', 'Replace QA Passed',
                                      'Replace Requested', 'Replacement Request Processing', 'Replace Approved', 'Replacement Processing', 'Replacement Shipped', 'Replacement Out for Delivery', 'Replaced'
                                  ))
                            ) THEN 'Refunded' 
                            WHEN $2::text IN ('Rejected', 'Denied') AND (return_type = 'Replace' OR status ILIKE '%Replace%') THEN 'Replace Rejected'
                            WHEN $2::text IN ('Rejected', 'Denied') AND (is_returned_order = TRUE OR delivered_at IS NOT NULL OR status ILIKE '%Return%') THEN 'Return Rejected'
                            WHEN $2::text IN ('Rejected', 'Denied', 'Restocked') AND NOT EXISTS (
                                SELECT 1 FROM order_items 
                                WHERE order_id = $1 
                                  AND (status IS NULL OR status NOT IN (
                                      'Cancelled', 'Cancellation Requested', 'CANCEL_REQUESTED', 'CANCEL_APPROVED',
                                      'Return Requested', 'Return Request Processing', 'Return Approved', 'Return Processing', 'Return Collected', 'Received at Homved', 'Returned', 'Refunded', 'Restocked', 'Return QA Passed', 'Replace QA Passed',
                                      'Replace Requested', 'Replacement Request Processing', 'Replace Approved', 'Replacement Processing', 'Replacement Shipped', 'Replacement Out for Delivery', 'Replaced'
                                  ))
                            ) THEN 'Cancelled'
                            ELSE status 
                          END,
                 refund_bank_account = COALESCE($8::text, refund_bank_account),
                 refund_ifsc_code = COALESCE($9::text, refund_ifsc_code),
                 refund_holder_name = COALESCE($10::text, refund_holder_name),
                 updated_at = NOW() 
             WHERE id = $1 
             RETURNING *`,
            [orderId, refundStatus, adminNote, finalTxnId || null, receiptUrl || null, notifyCustomer === true, refundData.logisticsStatus || null, refundData.bankDetails?.accountNumber || null, refundData.bankDetails?.ifscCode || null, refundData.bankDetails?.holderName || null]
        );

        if (updateResult.rows.length === 0) throw new Error('Order not found');
        const order = updateResult.rows[0];

        // Synchronize return item statuses on refund completion/restocking
        if (transitioningToFinal) {
            await client.query(
                `UPDATE order_items 
                 SET status = 'Refunded'
                 WHERE order_id = $1 AND (status = 'Return Approved' OR status = 'Received at Homved' OR status = 'Return Request Processing' OR status = 'Return Requested' OR status = 'Return QA Passed')`,
                [orderId]
            );
        } else if (refundStatus === 'Restocked') {
            await client.query(
                `UPDATE order_items
                 SET status = 'Returned'
                 WHERE order_id = $1 AND (status = 'Return Approved' OR status = 'Received at Homved' OR status = 'Return Request Processing' OR status = 'Return Requested' OR status = 'Return QA Passed')`,
                [orderId]
            );
        } else if (['Rejected', 'Denied'].includes(refundStatus)) {
            await client.query(
                `UPDATE order_items 
                 SET status = CASE 
                     WHEN status LIKE '%Replace%' THEN 'Replace Rejected' 
                     ELSE 'Return Rejected' 
                 END
                 WHERE order_id = $1 AND (status = 'Return Request Processing' OR status = 'Return Requested' OR status = 'Replacement Request Processing' OR status = 'Replace Requested' OR status = 'Return Approved' OR status = 'Replace Approved')`,
                [orderId]
            );
        }

        // INVENTORY AUTOMATION (Based on Logistics)
        const newLogistics = order.logistics_status;
        const reachedReceived = (newLogistics === 'Received' || newLogistics === 'Received at Homved' || newLogistics === 'Restocked' || refundStatus === 'Restocked') &&
            !oldIsProductReceived;

        if (reachedReceived) {
            // FIX: Scope restocking strictly to returned / refunded items
            const itemsResult = await client.query(
                `SELECT product_id, quantity FROM order_items 
                 WHERE order_id = $1 
                   AND status IN ('Returned', 'Refunded', 'Restocked', 'Received at Homved', 'Return QA Passed')`,
                [orderId]
            );
            console.log(`[LOGISTICS INVENTORY] Product reached Homved. Restoring stock ONLY for returned items of order ${orderId}. Count: ${itemsResult.rows.length}`);

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

        // Notification Logic for Refund Desk
        if (notifyCustomer) {
            try {
                const fullOrder = await exports.getOrderById(orderId);
                const refundAmt = Math.round(fullOrder?.refundAmount || fullOrder?.total || 0);
                const customMsg = adminNote 
                    ? `Hi ${fullOrder?.shippingAddress?.firstName || 'Customer'}, your refund of ₹${refundAmt} for Order #${fullOrder?.orderNumber} is marked as ${refundStatus}. Note: ${adminNote}`
                    : `Hi ${fullOrder?.shippingAddress?.firstName || 'Customer'}, refund of ₹${refundAmt} for your Order #${fullOrder?.orderNumber} has been updated to ${refundStatus}.`;
                await whatsappService.sendOrderUpdateNotification(fullOrder, (refundStatus === 'Completed' || refundStatus === 'Refunded') ? 'Refunded' : refundStatus, customMsg);
            } catch (notifyErr) {
                console.error('[Notification] Failed to send customer refund notification:', notifyErr.message);
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
        // Exclude return/cancel child split records (parent_item_id IS NOT NULL) and deduplicate by product_id
        const orderItemsResult = await client.query(
            `SELECT DISTINCT ON (oi.product_id) oi.product_id, oi.quantity as order_quantity, p.stock_quantity, p.instock, p.productname as name 
             FROM order_items oi
             JOIN products p ON oi.product_id::text = p.product_id::text
             WHERE oi.order_id = $1 AND oi.parent_item_id IS NULL`,
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

        // 2. Fetch order items that are actually in return lifecycle
        const itemsResult = await client.query(
            `SELECT product_id, quantity FROM order_items 
             WHERE order_id = $1 
               AND status IN ('Return Requested', 'Return Request Processing', 'Return Approved', 'Return Collected', 'Received at Homved', 'Returned', 'Refunded', 'Restocked', 'Return QA Passed')`,
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

        if (status === 'Replacement Shipped') {
            const item = result.rows[0];
            await client.query(
                `UPDATE products 
                 SET stock_quantity = GREATEST(0, stock_quantity - $2),
                     quantity = GREATEST(0, quantity - $2),
                     instock = (CASE WHEN stock_quantity - $2 > 0 THEN true ELSE false END),
                     updated_at = NOW()
                 WHERE product_id = $1::integer`,
                [item.product_id, item.quantity]
            );
        }

        // HOMVED-MULTI-PRODUCT: Re-evaluate parent order status on item status change
        const allItems = await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
        const orderRes = await client.query('SELECT status FROM orders WHERE id = $1', [orderId]);
        const currentOrderStatus = orderRes.rows[0]?.status;
        const newParentStatus = resolveParentOrderStatus(allItems.rows, currentOrderStatus);
        if (newParentStatus && newParentStatus !== currentOrderStatus) {
            await client.query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', [newParentStatus, orderId]);
        }

        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

let cachedApprovalMode = null;
let lastApprovalModeTime = 0;
const APPROVAL_MODE_TTL_MS = 60 * 1000;

exports.getOrderApprovalMode = async (forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && cachedApprovalMode && (now - lastApprovalModeTime < APPROVAL_MODE_TTL_MS)) {
        return cachedApprovalMode;
    }
    try {
        const res = await pool.query(`SELECT value FROM app_settings WHERE key = 'order_approval_mode'`);
        if (res.rows.length > 0) {
            cachedApprovalMode = res.rows[0].value;
            lastApprovalModeTime = now;
            return cachedApprovalMode;
        }
    } catch (e) {
        console.error('Error fetching order_approval_mode:', e.message);
    }
    cachedApprovalMode = 'automatic';
    lastApprovalModeTime = now;
    return 'automatic';
};

exports.setOrderApprovalMode = async (mode) => {
    const validMode = mode === 'manual' ? 'manual' : 'automatic';
    await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) 
         VALUES ('order_approval_mode', $1, NOW()) 
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [validMode]
    );
    cachedApprovalMode = validMode;
    lastApprovalModeTime = Date.now();
    return validMode;
};

exports.updateOrderAddress = async (orderId, addressData) => {
    const { address, city, state, pincode, fullName, customerName, name, phone, contactno } = addressData;
    const orderRes = await pool.query('SELECT address_id, user_id FROM orders WHERE id = $1', [orderId]);
    if (orderRes.rows.length === 0) throw new Error('Order not found');
    const { address_id: addressId, user_id: userId } = orderRes.rows[0];

    // Format Title Case for city and state if provided
    let cleanCity = city ? city.toString().trim() : null;
    if (cleanCity) {
        cleanCity = cleanCity.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
    let cleanState = state ? state.toString().trim() : null;
    if (cleanState) {
        cleanState = cleanState.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
    const cleanPincode = pincode ? pincode.toString().trim() : null;
    const cleanAddress = address ? address.trim() : null;

    if (addressId) {
        await pool.query(
            `UPDATE user_addresses 
             SET full_address = COALESCE($1, full_address),
                 city = COALESCE($2, city),
                 state = COALESCE($3, state),
                 postal_code = COALESCE($4, postal_code),
                 updated_at = NOW()
             WHERE id = $5`,
            [cleanAddress, cleanCity, cleanState, cleanPincode, addressId]
        );
    } else {
        const newAddr = await pool.query(
            `INSERT INTO user_addresses (user_id, address_label, full_address, city, state, postal_code, is_default, created_at, updated_at)
             VALUES ($1, 'Shipping Address', $2, $3, $4, $5, false, NOW(), NOW())
             RETURNING id`,
            [userId || 'guest', cleanAddress || 'Customer Address', cleanCity || 'Mumbai', cleanState || 'Maharashtra', cleanPincode || '400001']
        );
        await pool.query('UPDATE orders SET address_id = $1 WHERE id = $2', [newAddr.rows[0].id, orderId]);
    }

    const newName = (fullName || customerName || name || '').trim();
    const newPhone = (phone || contactno || '').trim();
    if (userId && (newName || newPhone)) {
        await pool.query(
            `UPDATE users 
             SET fullname = COALESCE(NULLIF($1, ''), fullname),
                 contactno = COALESCE(NULLIF($2, ''), contactno)
             WHERE username = $3`,
            [newName, newPhone, userId]
        );
    }

    return await exports.getOrderById(orderId);
};




/**
 * Confirm Return Package Received at Store and Generate Replacement Order (-REP)
 * Fulfills Requirement 3 & 4: Creates ORD...-REP linked to original order
 */
exports.confirmReceivedAndCreateReplacement = async (orderId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch parent order
        const parentRes = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        if (parentRes.rows.length === 0) throw new Error('Original order not found');
        const parentOrder = parentRes.rows[0];

        // 2. Prevent duplicate replacement orders
        const existingRep = await client.query('SELECT * FROM orders WHERE parent_order_id = $1', [orderId]);
        if (existingRep.rows.length > 0) {
            await client.query('COMMIT');
            return {
                parentOrder: await exports.getOrderById(orderId),
                replacementOrder: await exports.getOrderById(existingRep.rows[0].id)
            };
        }

        // 3. Mark original parent order as 'Received at Homved'
        await client.query(`
            UPDATE orders
            SET status = 'Received at Homved',
                is_product_received = true,
                logistics_status = 'Received at Store',
                updated_at = NOW()
            WHERE id = $1
        `, [orderId]);

        const replacementOrderRecord = await createReplacementOrderTx(client, parentOrder);

        await client.query('COMMIT');

        return {
            parentOrder: await exports.getOrderById(orderId),
            replacementOrder: await exports.getOrderById(replacementOrderRecord.id)
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[OrderService] confirmReceivedAndCreateReplacement Error:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Creates the "-REP" replacement order (₹0, Confirmed, ready for DTDC dispatch) for a parent order.
 * Must be called inside an open transaction. Returns the inserted order row.
 */
const createReplacementOrderTx = async (client, parentOrder) => {
        const orderId = parentOrder.id;

        // 4. Determine items to replace: strictly select items in replace cycle
        const itemsRes = await client.query(`
            SELECT * FROM order_items 
            WHERE order_id = $1 AND (
                status IN ('Replace Approved', 'Replacement Request Processing', 'Received at Homved', 'Replace QA Passed')
                OR status LIKE '%Replace%'
            )
        `, [orderId]);
        
        if (itemsRes.rows.length === 0) {
            throw new Error(`Cannot create replacement order for #${parentOrder.order_number}: No items are approved for replacement.`);
        }
        const itemsToReplace = itemsRes.rows;

        // 5. Generate new replacement order with -REP suffix
        const repOrderNumber = `${parentOrder.order_number}-REP`;
        // Value of the products being replaced (customer pays ₹0, but this is the real goods value
        // used for display and as the DTDC declared value)
        const replacedValue = itemsToReplace.reduce(
            (sum, it) => sum + (parseFloat(it.price) || 0) * (parseInt(it.quantity) || 1), 0
        );

        const insertRepOrder = await client.query(`
            INSERT INTO orders (
                user_id, order_number, address_id, payment_method, payment_status, payment_type,
                subtotal, shipping, total, original_total, status, logistics_provider,
                is_replacement, parent_order_id, original_order_id, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, 'Paid', 'Replacement (₹0)',
                0, 0, 0, $5, 'Confirmed', 'DTDC',
                true, $6, $6, NOW(), NOW()
            ) RETURNING *
        `, [
            parentOrder.user_id,
            repOrderNumber,
            parentOrder.address_id,
            parentOrder.payment_method || 'cod',
            replacedValue || parentOrder.total || 0,
            orderId
        ]);

        const replacementOrderRecord = insertRepOrder.rows[0];

        // 6. Insert items into new replacement order with parent_item_id link and update parent items
        for (const item of itemsToReplace) {
            await client.query(`
                INSERT INTO order_items (
                    order_id, product_id, name, price, quantity, image, status, parent_item_id, created_at
                ) VALUES (
                    $1, $2, $3, 0, $4, $5, 'Confirmed', $6, NOW()
                )
            `, [
                replacementOrderRecord.id,
                item.product_id,
                item.name,
                item.quantity,
                item.image,
                item.id
            ]);

            // Mark the original parent item row as 'Replace QA Passed' (until the replacement shipment is delivered)
            await client.query(
                `UPDATE order_items SET status = 'Replace QA Passed' WHERE id = $1`,
                [item.id]
            );
        }

        console.log(`[OrderService] Generated Replacement Order ${repOrderNumber} for Parent ${parentOrder.order_number}`);
        return replacementOrderRecord;
};

/**
 * QA inspection of a parcel that has been Received at Homved.
 *  - Return  + pass → 'Return QA Passed'  (released to Refund Desk)
 *  - Return  + fail → 'Return QA Failed'  (refund rejected, reason shown to customer)
 *  - Replace + pass → 'Replace QA Passed' (-REP replacement order auto-created for dispatch)
 *  - Replace + fail → 'Replace QA Failed' (replacement rejected, reason shown to customer)
 */
exports.recordQaInspection = async (orderId, { passed, notes, checkedBy } = {}) => {
    await ensureQaColumns();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const orderRes = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        if (orderRes.rows.length === 0) throw new Error('Order not found');
        const order = orderRes.rows[0];

        if (order.status !== 'Received at Homved') {
            const err = new Error(`QA inspection can only be done once the parcel is "Received at Homved" (current status: "${order.status}").`);
            err.statusCode = 400;
            throw err;
        }
        const cleanNotes = (notes || '').trim();
        if (!passed && !cleanNotes) {
            const err = new Error('Please provide the reason why the parcel failed QA.');
            err.statusCode = 400;
            throw err;
        }

        // Determine cycle: replacement if return_type says so or any item is in the replace cycle
        const itemsRes = await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
        const isReplace = order.return_type === 'Replace' ||
            itemsRes.rows.some(i => (i.status || '').startsWith('Replace'));
        const prefix = isReplace ? 'Replace' : 'Return';
        const newStatus = `${prefix} QA ${passed ? 'Passed' : 'Failed'}`;

        // Items that were part of this reverse shipment
        const cycleItemStatuses = ['Received at Homved', ...(isReplace ? REPLACE_CYCLE_ITEM_STATUSES : RETURN_CYCLE_ITEM_STATUSES)];
        const affected = itemsRes.rows.filter(i => cycleItemStatuses.includes(i.status));

        await client.query(
            `UPDATE order_items SET status = $2::text WHERE order_id = $1::uuid AND status = ANY($3::text[])`,
            [orderId, newStatus, cycleItemStatuses]
        );

        // Failed QA: product is not resellable → undo the stock restore done on "Received at Homved".
        // Only returns are restocked on receipt (replacement units never are), and only the affected items.
        if (!passed && order.is_product_received && !isReplace) {
            for (const item of affected) {
                await client.query(
                    `UPDATE products
                     SET stock_quantity = GREATEST(0, stock_quantity - $2),
                         quantity = GREATEST(0, quantity - $2),
                         instock = (CASE WHEN stock_quantity - $2 > 0 THEN true ELSE false END),
                         updated_at = NOW()
                     WHERE product_id = $1::integer`,
                    [item.product_id, item.quantity]
                );
            }
        }

        await client.query(
            `UPDATE orders SET
                status = $2::text,
                logistics_status = $2::text,
                qa_status = $3::text,
                qa_notes = $4::text,
                qa_checked_at = NOW(),
                qa_checked_by = $5::text,
                rejection_reason = CASE WHEN $6::boolean THEN rejection_reason ELSE $4::text END,
                refund_status = CASE
                    WHEN $7::boolean AND $6::boolean THEN 'Pending'
                    WHEN $7::boolean AND NOT $6::boolean THEN 'Rejected'
                    ELSE refund_status
                END,
                updated_at = NOW()
             WHERE id = $1::uuid`,
            [orderId, newStatus, passed ? 'Passed' : 'Failed', cleanNotes || null, checkedBy || null, !!passed, !isReplace]
        );

        // Replacement passed QA → create the -REP order for dispatch
        let replacementOrderRecord = null;
        if (isReplace && passed) {
            const existingRep = await client.query('SELECT * FROM orders WHERE parent_order_id = $1', [orderId]);
            replacementOrderRecord = existingRep.rows[0] || await createReplacementOrderTx(client, order);
        }

        await client.query('COMMIT');

        const updatedOrder = await exports.getOrderById(orderId);
        try {
            await whatsappService.sendOrderUpdateNotification(updatedOrder, newStatus);
        } catch (notifyErr) {
            console.error('[QA] Notification failed:', notifyErr.message);
        }

        return {
            order: updatedOrder,
            replacementOrder: replacementOrderRecord ? await exports.getOrderById(replacementOrderRecord.id) : null
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[OrderService] recordQaInspection Error:', error.message);
        throw error;
    } finally {
        client.release();
    }
};


/**
 * HOMVED-MULTI-PRODUCT: Centralized Financial Refund Breakdown & Previous Refund Reconciliation
 */
exports.calculateOrderRefundBreakdown = async (orderId) => {
    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (orderRes.rows.length === 0) throw new Error('Order not found');
    const order = orderRes.rows[0];

    const itemsRes = await pool.query(
        `SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
        [orderId]
    );
    const items = itemsRes.rows;

    const initialSubtotal = parseFloat(order.initial_subtotal || order.subtotal || 0);
    const totalDiscount = parseFloat(order.discount_amount || 0);
    const orderShipping = parseFloat(order.shipping || 0);

    const isItemReturned = (st) => {
        if (!st) return false;
        const lower = st.toLowerCase();
        return lower.includes('return') || ['received at homved', 'restocked', 'refunded'].includes(lower);
    };

    const isItemCancelled = (st) => {
        if (!st) return false;
        const lower = st.toLowerCase();
        return lower.includes('cancel');
    };

    let totalEligibleRefund = 0;
    let previouslyRefundedTotal = 0;

    const itemBreakdowns = items.map(it => {
        const itemPrice = parseFloat(it.price || 0);
        const itemQty = parseInt(it.quantity || 1);
        const itemGross = Math.round(itemPrice * itemQty * 100) / 100;
        
        // Proportional discount
        const propDiscount = initialSubtotal > 0 ? Math.round(((itemGross / initialSubtotal) * totalDiscount) * 100) / 100 : 0;
        const itemNetValue = Math.max(0, itemGross - propDiscount);

        const isCancelled = isItemCancelled(it.status);
        const isReturned = isItemReturned(it.status);
        const isEligible = isCancelled || isReturned;

        const previousRefund = parseFloat(it.refund_amount || 0);
        previouslyRefundedTotal += previousRefund;

        const remainingRefund = isEligible ? Math.max(0, itemNetValue - previousRefund) : 0;
        if (isEligible) {
            totalEligibleRefund += remainingRefund;
        }

        return {
            id: it.id,
            productId: it.product_id,
            name: it.name,
            quantity: itemQty,
            price: itemPrice,
            grossTotal: itemGross,
            allocatedDiscount: propDiscount,
            netValue: itemNetValue,
            status: it.status,
            isCancelled,
            isReturned,
            isEligible,
            previouslyRefunded: previousRefund,
            eligibleRefund: remainingRefund
        };
    });

    // Shipping refund rule: only refunded if 100% of order items are cancelled or returned
    const allItemsEligible = items.length > 0 && items.every(it => isItemCancelled(it.status) || isItemReturned(it.status));
    let refundableShipping = 0;
    if (allItemsEligible && orderShipping > 0) {
        refundableShipping = orderShipping;
        totalEligibleRefund += refundableShipping;
    }

    return {
        orderId: order.id,
        orderNumber: order.order_number,
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status,
        refundStatus: order.refund_status,
        orderTotal: parseFloat(order.total || 0),
        codBalanceDue: order.cod_balance_due !== null ? parseFloat(order.cod_balance_due) : null,
        initialSubtotal,
        totalDiscount,
        shipping: orderShipping,
        refundableShipping,
        allItemsEligible,
        previouslyRefundedTotal: Math.round(previouslyRefundedTotal * 100) / 100,
        totalEligibleRefund: Math.round(totalEligibleRefund * 100) / 100,
        items: itemBreakdowns
    };
};
