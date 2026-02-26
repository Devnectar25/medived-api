const pool = require('../config/db');
const analyticsService = require('../ga/analyticsService.cjs');

/**
 * Fetch top customers by total spending
 * @param {number} limit 
 */
exports.getTopCustomers = async (limit = 10) => {
    const query = `
        SELECT
            u.username                        AS id,
            u.username,
            u.emailid                         AS email,
            u.contactno,
            COUNT(o.id)                       AS total_orders,
            COALESCE(SUM(o.total), 0)         AS total_revenue
        FROM users u
        LEFT JOIN orders o ON u.username = o.user_id
            AND o.status NOT IN ('Cancelled', 'Returned')
        GROUP BY u.username, u.emailid, u.contactno
        ORDER BY total_revenue DESC, total_orders DESC
        LIMIT $1
    `;
    const result = await pool.query(query, [limit]);
    return result.rows.map(row => ({
        ...row,
        total_orders: parseInt(row.total_orders, 10),
        total_revenue: parseFloat(row.total_revenue),
        order_count: parseInt(row.total_orders, 10)  // alias for frontend compatibility
    }));
};

/**
 * Fetch all customers
 */
/**
 * Fetch all customers with their assignment status for a given coupon.
 * @param {number|null} couponId  - optional; when provided each row gets a `status` field
 */
exports.getAllUsers = async (couponId = null) => {
    const query = couponId
        ? `SELECT
               u.username           AS id,
               u.username,
               u.emailid            AS email,
               u.contactno,
               u.createdate         AS created_at,
               ca.status
           FROM users u
           LEFT JOIN coupon_assignments ca
               ON ca.user_id = u.username AND ca.coupon_id = $1
           ORDER BY u.createdate DESC`
        : `SELECT
               username             AS id,
               username,
               emailid              AS email,
               contactno,
               createdate           AS created_at,
               NULL                 AS status
           FROM users
           ORDER BY createdate DESC`;

    const result = couponId
        ? await pool.query(query, [couponId])
        : await pool.query(query);
    return result.rows;
};

/**
 * Fetch users by IDs
 * @param {Array} userIds 
 */
exports.getUsersByIds = async (userIds) => {
    if (!userIds || userIds.length === 0) return [];

    // Verifying userIds are strings (usernames)
    const query = `
        SELECT username as id, username, emailid as email, contactno
        FROM users
        WHERE username = ANY($1)
    `;
    const result = await pool.query(query, [userIds]);
    return result.rows;
};

/**
 * Assign coupon to multiple users
 * @param {number} couponId 
 * @param {Array} userIds 
 */
exports.assignCouponToUsers = async (couponId, userIds) => {
    if (!userIds || userIds.length === 0) return { success: true, assignedCount: 0 };

    // Verify coupon exists and is active
    const couponCheck = await pool.query(
        'SELECT id FROM coupons WHERE id = $1 AND active = true',
        [couponId]
    );
    if (couponCheck.rows.length === 0) throw new Error('Invalid or inactive coupon ID');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Bulk INSERT via unnest — single DB round-trip regardless of user count.
        // ON CONFLICT behaviour:
        //   • truly new row            → INSERT (assigned)
        //   • existing status=revoked  → UPDATE back to assigned (reactivate)
        //   • existing status=assigned → DO NOTHING (already active)
        //   • existing status=used     → DO NOTHING (preserve usage history)
        const result = await client.query(
            `INSERT INTO coupon_assignments (coupon_id, user_id, status, assigned_at)
             SELECT $1, unnest($2::text[]), 'assigned', NOW()
             ON CONFLICT (coupon_id, user_id)
             DO UPDATE
                 SET status      = 'assigned',
                     assigned_at = NOW()
                 WHERE coupon_assignments.status = 'revoked'
             RETURNING id`,
            [couponId, userIds]
        );

        await client.query('COMMIT');
        return { success: true, assignedCount: result.rowCount };

    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

exports.getActiveUsers = async (limit = 50) => {
    try {
        const activeUsers = await analyticsService.getTopActiveUsers('30d', limit);

        return activeUsers.map(u => ({
            id: u.userId,
            username: u.userName,
            email: u.email,
            contactno: u.phone,
            order_count: parseInt(u.totalOrders || 0, 10),
            revenue: parseFloat(u.totalRevenue || 0),
            last_active: u.lastActiveDate
        }));

    } catch (error) {
        console.error("Error fetching active users:", error);
        return [];
    }
};
