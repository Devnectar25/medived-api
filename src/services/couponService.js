const pool = require('../config/db');

/**
 * Create a new coupon
 * @param {Object} data - { code, discount_type, discount_value, min_order_value, usage_limit, expiry_date, apply_to, category_ids, brand_ids, product_ids }
 */
exports.createCoupon = async (data) => {
    const {
        code, discount_type, discount_value, min_order_value, usage_limit, expiry_date,
        apply_to, category_ids, brand_ids, product_ids, is_restricted
    } = data;

    // ── Validate discount_type ─────────────────────────────────────────────────
    const allowedTypes = ['percentage', 'fixed', 'bogo'];
    const normType = (discount_type || '').toString().trim().toLowerCase();
    if (!normType || !allowedTypes.includes(normType)) {
        throw new Error(`discount_type must be one of: ${allowedTypes.join(', ')}`);
    }

    // ── Validate discount_value ────────────────────────────────────────────────
    const parsedValue = parseFloat(discount_value);
    if (discount_value === undefined || discount_value === null || isNaN(parsedValue)) {
        throw new Error('discount_value is required and must be a number');
    }
    if (parsedValue < 0) {
        throw new Error('discount_value cannot be negative');
    }
    if (normType === 'percentage' && parsedValue > 100) {
        throw new Error('Percentage discount cannot exceed 100%');
    }

    // ── Validate expiry_date ───────────────────────────────────────────────────
    if (!expiry_date) {
        throw new Error('expiry_date is required');
    }
    if (new Date(expiry_date) <= new Date()) {
        throw new Error('expiry_date must be a future date');
    }

    // ── Validate scope consistency ─────────────────────────────────────────────
    const allowedScopes = ['all', 'category', 'brand', 'product'];
    const finalScope = apply_to || 'all';
    if (!allowedScopes.includes(finalScope)) {
        throw new Error(`apply_to must be one of: ${allowedScopes.join(', ')}`);
    }

    // ── Normalize and deduplicate code ─────────────────────────────────────────
    let finalCode = code ? code.trim().toUpperCase() : null;
    if (!finalCode) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 8; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
        finalCode = `HOM${result}`;
    }

    const existing = await pool.query('SELECT id FROM coupons WHERE code = $1', [finalCode]);
    if (existing.rows.length > 0) {
        throw new Error('Coupon code already exists');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ── Insert Base Coupon ─────────────────────────────────────────────────
        // We still store the first one in the old columns for maximum 
        // backward compatibility with external systems if any.
        const mainCatId = (Array.isArray(category_ids) && category_ids.length > 0) ? category_ids[0] : null;
        const mainBrandId = (Array.isArray(brand_ids) && brand_ids.length > 0) ? brand_ids[0] : null;
        const mainProdId = (Array.isArray(product_ids) && product_ids.length > 0) ? product_ids[0] : null;

        const result = await client.query(
            `INSERT INTO coupons (
                code, discount_type, discount_value, min_order_value, usage_limit,
                expiry_date, apply_to, category_id, brand_id, product_id, is_restricted
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *`,
            [
                finalCode,
                normType,
                parsedValue,
                parseFloat(min_order_value) || 0,
                parseInt(usage_limit) || 1,
                expiry_date,
                finalScope,
                mainCatId,
                mainBrandId,
                mainProdId,
                is_restricted === true || is_restricted === 'true'
            ]
        );
        const coupon = result.rows[0];

        // ── Insert Scope Records ───────────────────────────────────────────────
        if (finalScope === 'category' && Array.isArray(category_ids)) {
            for (const cid of category_ids) {
                await client.query('INSERT INTO coupon_categories (coupon_id, category_id) VALUES ($1, $2)', [coupon.id, cid]);
            }
        } else if (finalScope === 'brand' && Array.isArray(brand_ids)) {
            for (const bid of brand_ids) {
                await client.query('INSERT INTO coupon_brands (coupon_id, brand_id) VALUES ($1, $2)', [coupon.id, bid]);
            }
        } else if (finalScope === 'product' && Array.isArray(product_ids)) {
            for (const pid of product_ids) {
                await client.query('INSERT INTO coupon_products (coupon_id, product_id) VALUES ($1, $2)', [coupon.id, pid]);
            }
        }

        await client.query('COMMIT');
        return coupon;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Update an existing coupon
 */
exports.updateCoupon = async (id, data) => {
    const {
        discount_type, discount_value, min_order_value, usage_limit, expiry_date,
        apply_to, category_ids, brand_ids, product_ids, is_restricted, active
    } = data;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check existence
        const existingRes = await client.query('SELECT * FROM coupons WHERE id = $1', [id]);
        if (existingRes.rows.length === 0) throw new Error('Coupon not found');
        const existing = existingRes.rows[0];

        const allowedTypes = ['percentage', 'fixed', 'bogo'];
        const normDiscountType = discount_type ? discount_type.toString().trim().toLowerCase() : undefined;
        if (normDiscountType !== undefined && !allowedTypes.includes(normDiscountType)) {
            throw new Error(`discount_type must be one of: ${allowedTypes.join(', ')}`);
        }

        const effectiveType = (normDiscountType || existing.discount_type || 'percentage').toLowerCase();
        let effectiveValue = discount_value !== undefined && discount_value !== null && discount_value !== ''
            ? parseFloat(discount_value)
            : parseFloat(existing.discount_value);

        if (discount_value !== undefined && discount_value !== null && discount_value !== '') {
            if (isNaN(effectiveValue) || effectiveValue < 0) {
                throw new Error('discount_value must be a non-negative number');
            }
        }

        if (effectiveType === 'percentage') {
            if (discount_value !== undefined && discount_value !== null && discount_value !== '') {
                if (effectiveValue > 100) {
                    throw new Error('Percentage discount cannot exceed 100%');
                }
            } else if (effectiveValue > 100) {
                effectiveValue = 100;
            }
        }

        const finalScope = apply_to || existing.apply_to;
        const mainCatId = (Array.isArray(category_ids) && category_ids.length > 0) ? category_ids[0] : (finalScope === 'category' ? existing.category_id : null);
        const mainBrandId = (Array.isArray(brand_ids) && brand_ids.length > 0) ? brand_ids[0] : (finalScope === 'brand' ? existing.brand_id : null);
        const mainProdId = (Array.isArray(product_ids) && product_ids.length > 0) ? product_ids[0] : (finalScope === 'product' ? existing.product_id : null);

        // Update base fields
        await client.query(
            `UPDATE coupons SET
                discount_type = COALESCE($2, discount_type),
                discount_value = $3,
                min_order_value = COALESCE($4, min_order_value),
                usage_limit = COALESCE($5, usage_limit),
                expiry_date = COALESCE($6, expiry_date),
                apply_to = $7,
                category_id = $8,
                brand_id = $9,
                product_id = $10,
                is_restricted = COALESCE($11, is_restricted),
                active = COALESCE($12, active)
            WHERE id = $1`,
            [
                id, normDiscountType, effectiveValue, min_order_value, usage_limit,
                expiry_date, finalScope, mainCatId, mainBrandId, mainProdId,
                is_restricted, active
            ]
        );

        // Update join tables
        // 1. Clear old
        await client.query('DELETE FROM coupon_categories WHERE coupon_id = $1', [id]);
        await client.query('DELETE FROM coupon_brands WHERE coupon_id = $1', [id]);
        await client.query('DELETE FROM coupon_products WHERE coupon_id = $1', [id]);

        // 2. Insert new
        if (finalScope === 'category' && Array.isArray(category_ids)) {
            for (const cid of category_ids) {
                await client.query('INSERT INTO coupon_categories (coupon_id, category_id) VALUES ($1, $2)', [id, cid]);
            }
        } else if (finalScope === 'brand' && Array.isArray(brand_ids)) {
            for (const bid of brand_ids) {
                await client.query('INSERT INTO coupon_brands (coupon_id, brand_id) VALUES ($1, $2)', [id, bid]);
            }
        } else if (finalScope === 'product' && Array.isArray(product_ids)) {
            for (const pid of product_ids) {
                await client.query('INSERT INTO coupon_products (coupon_id, product_id) VALUES ($1, $2)', [id, pid]);
            }
        }

        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Get all coupons
 */
exports.getAllCoupons = async () => {
    const result = await pool.query(`
        SELECT
            c.*,
            COUNT(DISTINCT ca.user_id)::int AS assigned_count,
            COUNT(DISTINCT o.id)::int AS times_used,
            COALESCE((SELECT json_agg(category_id) FROM coupon_categories WHERE coupon_id = c.id), '[]') as category_ids,
            COALESCE((SELECT json_agg(brand_id) FROM coupon_brands WHERE coupon_id = c.id), '[]') as brand_ids,
            COALESCE((SELECT json_agg(product_id) FROM coupon_products WHERE coupon_id = c.id), '[]') as product_ids
        FROM coupons c
        LEFT JOIN coupon_assignments ca
            ON ca.coupon_id = c.id
        LEFT JOIN orders o
            ON o.coupon_code = c.code AND (o.status IS NULL OR o.status NOT IN ('Cancelled', 'CANCEL_APPROVED'))
        GROUP BY c.id
        ORDER BY c.created_at DESC
    `);

    return result.rows.map(c => {
        const dType = (c.discount_type || 'percentage').toLowerCase();
        let dVal = parseFloat(c.discount_value);
        if (dType === 'percentage' && dVal > 100) {
            dVal = 100;
        }
        const usedCount = (c.used_count !== null && c.used_count !== undefined) 
            ? parseInt(c.used_count, 10) 
            : parseInt(c.times_used, 10);
        return {
            ...c,
            discount_type: dType,
            discount_value: isNaN(dVal) ? c.discount_value : dVal,
            used_count: usedCount,
            times_used: usedCount
        };
    });
};

/**
 * Toggle coupon status
 */
exports.toggleCouponStatus = async (id) => {
    const result = await pool.query(
        'UPDATE coupons SET active = NOT active WHERE id = $1 RETURNING *',
        [id]
    );
    if (result.rows.length === 0) throw new Error('Coupon not found');
    return result.rows[0];
};

/**
 * Delete coupon
 */
exports.deleteCoupon = async (id) => {
    const result = await pool.query('DELETE FROM coupons WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) throw new Error('Coupon not found');
    return { success: true };
};

/**
 * Get coupon by code
 */
exports.getCouponByCode = async (code) => {
    const result = await pool.query('SELECT * FROM coupons WHERE code = $1', [code]);
    return result.rows[0];
};

/**
 * Validate coupon code against order details
 */
exports.validateCoupon = async (code, orderTotal, cartItems = [], userId = null) => {
    const normalizedCode = (code || '').trim().toUpperCase();
    if (!normalizedCode) throw new Error('Coupon code is required');

    const parsedTotal = parseFloat(orderTotal);
    if (isNaN(parsedTotal) || parsedTotal < 0) throw new Error('Invalid order total');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const couponResult = await client.query(
            `SELECT c.*,
                COALESCE((SELECT json_agg(category_id) FROM coupon_categories WHERE coupon_id = c.id), '[]') as category_ids,
                COALESCE((SELECT json_agg(brand_id) FROM coupon_brands WHERE coupon_id = c.id), '[]') as brand_ids,
                COALESCE((SELECT json_agg(product_id) FROM coupon_products WHERE coupon_id = c.id), '[]') as product_ids
             FROM coupons c WHERE c.code = $1 FOR UPDATE`,
            [normalizedCode]
        );
        const coupon = couponResult.rows[0];

        if (!coupon) throw new Error('Invalid coupon code');
        if (!coupon.active) throw new Error('This coupon is no longer active');
        if (coupon.expiry_date && new Date() > new Date(coupon.expiry_date)) {
            throw new Error('This coupon has expired');
        }
        if (parsedTotal < parseFloat(coupon.min_order_value)) {
            throw new Error(`Minimum order value of ₹${parseFloat(coupon.min_order_value).toFixed(2)} required`);
        }

        const usageResult = await client.query(
            `SELECT COUNT(*) AS count FROM orders 
             WHERE coupon_code = $1 
               AND (status IS NULL OR status NOT IN ('Cancelled', 'CANCEL_APPROVED'))`,
            [normalizedCode]
        );
        const orderActiveCount = parseInt(usageResult.rows[0].count, 10);
        const effectiveUsedCount = (coupon.used_count !== null && coupon.used_count !== undefined)
            ? parseInt(coupon.used_count, 10)
            : orderActiveCount;

        if (effectiveUsedCount >= parseInt(coupon.usage_limit, 10)) {
            throw new Error('This coupon has reached its usage limit');
        }

        if (coupon.is_restricted && userId) {
            const userAssignmentResult = await client.query(
                `SELECT id FROM coupon_assignments WHERE coupon_id = $1 AND user_id = $2 AND status = 'assigned'`,
                [coupon.id, userId]
            );
            if (userAssignmentResult.rows.length === 0) {
                throw new Error('This coupon is restricted to specific accounts');
            }
        }

        // ── Scope validation ────────────────────────────────────────────────
        let applicableTotal = parsedTotal;
        let eligibleItems = cartItems;

        if (coupon.apply_to && coupon.apply_to !== 'all' && cartItems.length > 0) {
            eligibleItems = cartItems.filter(item => {
                if (coupon.apply_to === 'product') {
                    const pids = coupon.product_ids || [];
                    if (pids.length > 0) return pids.includes(Number(item.product_id || item.id));
                    return String(item.product_id || item.id) === String(coupon.product_id);
                }
                if (coupon.apply_to === 'category') {
                    const cids = coupon.category_ids || [];
                    if (cids.length > 0) return cids.includes(Number(item.category_id));
                    return String(item.category_id) === String(coupon.category_id);
                }
                if (coupon.apply_to === 'brand') {
                    const bids = coupon.brand_ids || [];
                    if (bids.length > 0) return bids.includes(Number(item.brand_id));
                    return String(item.brand_id) === String(coupon.brand_id);
                }
                return false;
            });

            if (eligibleItems.length === 0) {
                throw new Error(`This coupon only applies to specific ${coupon.apply_to}s not present in your cart`);
            }
            applicableTotal = eligibleItems.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.quantity, 10)), 0);
        } else if (coupon.apply_to && coupon.apply_to !== 'all' && cartItems.length === 0) {
            throw new Error('Cart items are required to validate this coupon');
        }

        // ── Discount calculation ────────────────────────────────────────────
        let discountAmount = 0;
        let bogoAutoAdd = false;
        let bogoItemId = null;
        let bogoItemName = null;

        const dType = (coupon.discount_type || '').toLowerCase();
        const dValue = parseFloat(coupon.discount_value) || 0;

        if (dType === 'percentage') {
            const validPct = Math.min(100, Math.max(0, dValue));
            discountAmount = (applicableTotal * validPct) / 100;
        } else if (dType === 'fixed') {
            discountAmount = Math.min(dValue, applicableTotal);
        } else if (dType === 'bogo') {
            // HOM-128: Refined BOGO logic - Buy 1 (or more), Get 1 Free
            // The discount only triggers if an eligible item has quantity >= 2.
            // The discount is exactly ONE unit price of that item.
            
            const itemsWithQty2 = eligibleItems.filter(item => parseInt(item.quantity || 1, 10) >= 2);
            
            if (itemsWithQty2.length === 0) {
                if (eligibleItems.length > 0) {
                    throw new Error('This BOGO coupon requires at least 2 units of an eligible product in your cart.');
                } else {
                    // This case is actually caught by the scope validation above, but kept for robustness
                    throw new Error(`This BOGO coupon only applies to specific ${coupon.apply_to}s not present in your cart.`);
                }
            }
            
            // If multiple eligible products have qty >= 2, we pick the highest priced one for the discount.
            const maxPriceItem = itemsWithQty2.reduce((prev, current) => {
                return (parseFloat(prev.price) > parseFloat(current.price)) ? prev : current;
            }, itemsWithQty2[0]);
            
            discountAmount = parseFloat(maxPriceItem.price);
            
            // Result fields for frontend display
            bogoItemId = maxPriceItem.id || maxPriceItem.product_id;
            bogoItemName = maxPriceItem.name || maxPriceItem.productname;
        }

        if (discountAmount > parsedTotal) discountAmount = parsedTotal;
        if (discountAmount < 0) discountAmount = 0;

        await client.query('COMMIT');

        return {
            isValid: true,
            bogoAutoAdd,
            bogoItemId,
            bogoItemName,
            coupon: {
                id: coupon.id,
                code: coupon.code,
                discount_type: dType,
                discount_value: dType === 'percentage' ? Math.min(100, Math.max(0, dValue)) : dValue,
                apply_to: coupon.apply_to,
                category_ids: coupon.category_ids,
                brand_ids: coupon.brand_ids,
                product_ids: coupon.product_ids,
                // Backward compatibility fields
                brand_id: coupon.brand_id ?? null,
                category_id: coupon.category_id ?? null,
                product_id: coupon.product_id ?? null,
            },
            discountAmount: parseFloat(discountAmount.toFixed(2)),
            finalTotal: parseFloat((parsedTotal - discountAmount).toFixed(2))
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Get coupons available to a specific user
 */
exports.getUserCoupons = async (userId) => {
    const result = await pool.query(
        `SELECT c.*,
             COALESCE((SELECT json_agg(category_id) FROM coupon_categories WHERE coupon_id = c.id), '[]') as category_ids,
             COALESCE((SELECT json_agg(brand_id) FROM coupon_brands WHERE coupon_id = c.id), '[]') as brand_ids,
             COALESCE((SELECT json_agg(product_id) FROM coupon_products WHERE coupon_id = c.id), '[]') as product_ids,
             CASE 
                WHEN c.is_restricted = true AND EXISTS (SELECT 1 FROM coupon_assignments ca WHERE ca.coupon_id = c.id AND ca.user_id = $1 AND ca.status = 'assigned') THEN true 
                ELSE false 
             END AS is_assigned
         FROM coupons c
         WHERE c.active = true
             AND (c.expiry_date IS NULL OR c.expiry_date::date >= CURRENT_DATE)
             AND (COALESCE(c.is_restricted, false) = false OR EXISTS (SELECT 1 FROM coupon_assignments ca WHERE ca.coupon_id = c.id AND ca.user_id = $1 AND ca.status = 'assigned'))
         ORDER BY c.created_at DESC`,
        [userId]
    );
    return result.rows.map(c => {
        const dType = (c.discount_type || 'percentage').toLowerCase();
        let dVal = parseFloat(c.discount_value);
        if (dType === 'percentage' && dVal > 100) {
            dVal = 100;
        }
        return {
            ...c,
            discount_type: dType,
            discount_value: isNaN(dVal) ? c.discount_value : dVal
        };
    });
};

exports.getCouponAssignments = async (couponId) => {
    const result = await pool.query(
        `SELECT u.username, u.emailid, ca.assigned_at, ca.status FROM coupon_assignments ca JOIN users u ON u.username = ca.user_id WHERE ca.coupon_id = $1 ORDER BY ca.assigned_at DESC`,
        [couponId]
    );
    return result.rows;
};

exports.revokeAssignment = async (couponId, userId) => {
    const result = await pool.query(`UPDATE coupon_assignments SET status = 'revoked' WHERE coupon_id = $1 AND user_id = $2 RETURNING *`, [couponId, userId]);
    if (result.rows.length === 0) throw new Error('Assignment not found');
    return result.rows[0];
};

exports.getUsedUsers = async (couponId) => {
    const couponRes = await pool.query('SELECT code FROM coupons WHERE id = $1', [couponId]);
    if (couponRes.rows.length === 0) return [];
    const code = couponRes.rows[0].code;
    const result = await pool.query(
        `SELECT u.username, u.emailid as email, o.created_at as order_date 
         FROM orders o 
         JOIN users u ON u.username = o.user_id 
         WHERE o.coupon_code = $1 
           AND (o.status IS NULL OR o.status NOT IN ('Cancelled', 'CANCEL_APPROVED'))
         ORDER BY o.created_at DESC`,
        [code]
    );
    return result.rows;
};

/**
 * Consume a coupon usage (increment used_count and mark assignment as used)
 */
exports.consumeCouponUsage = async (dbClient, couponCode, couponId, userId) => {
    if (!couponCode) return;
    const normalizedCode = couponCode.trim().toUpperCase();

    // 1. Increment used_count on coupons table
    await dbClient.query(
        `UPDATE coupons 
         SET used_count = COALESCE(used_count, 0) + 1 
         WHERE code = $1`,
        [normalizedCode]
    );

    // 2. Mark coupon assignment as used if restricted/assigned to this user
    if (userId) {
        await dbClient.query(
            `UPDATE coupon_assignments
             SET status = 'used', used_at = CURRENT_TIMESTAMP
             WHERE coupon_id = (SELECT id FROM coupons WHERE code = $1)
               AND user_id = $2
               AND status = 'assigned'`,
            [normalizedCode, userId]
        );
    }
};

/**
 * Restore a coupon usage (decrement used_count and restore assignment status to 'assigned')
 */
exports.restoreCouponUsage = async (dbClient, couponCode, couponId, userId) => {
    if (!couponCode) return;
    const normalizedCode = couponCode.trim().toUpperCase();

    // 1. Decrement used_count on coupons table (never drop below 0)
    await dbClient.query(
        `UPDATE coupons 
         SET used_count = GREATEST(0, COALESCE(used_count, 0) - 1) 
         WHERE code = $1`,
        [normalizedCode]
    );

    // 2. Restore assignment back to 'assigned' if it was marked as used
    if (userId) {
        await dbClient.query(
            `UPDATE coupon_assignments
             SET status = 'assigned', used_at = NULL
             WHERE coupon_id = (SELECT id FROM coupons WHERE code = $1)
               AND user_id = $2
               AND status = 'used'`,
            [normalizedCode, userId]
        );
    }
};
