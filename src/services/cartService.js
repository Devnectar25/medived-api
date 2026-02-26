const pool = require('../config/db');

exports.getCart = async (userId) => {
    const result = await pool.query(
        `SELECT
            c.id,
            c.product_id,
            c.quantity,
            p.productname  AS name,
            p.price,
            p.image,
            p.originalprice,
            p.discount,
            p.category_id,
            p.brand        AS brand_id
         FROM cart_items c
         JOIN products p ON c.product_id = p.product_id
         WHERE c.user_id = $1`,
        [userId]
    );
    return result.rows.map(item => ({
        ...item,
        productId: item.product_id.toString(),
        price: parseFloat(item.price),
        originalPrice: parseFloat(item.originalprice),
        discount: parseFloat(item.discount),
        category_id: item.category_id ?? null,
        brand_id: item.brand_id ?? null
    }));
};

exports.addToCart = async (userId, productId, quantity) => {
    const result = await pool.query(
        `INSERT INTO cart_items (user_id, product_id, quantity, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, product_id)
         DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = NOW()
         RETURNING *`,
        [userId, productId, quantity]
    );
    return result.rows[0];
};

exports.updateQuantity = async (userId, productId, quantity) => {
    const result = await pool.query(
        `UPDATE cart_items
         SET quantity = $3, updated_at = NOW()
         WHERE user_id = $1 AND product_id = $2
         RETURNING *`,
        [userId, productId, quantity]
    );
    return result.rows[0];
};

exports.removeFromCart = async (userId, productId) => {
    const result = await pool.query(
        `DELETE FROM cart_items
         WHERE user_id = $1 AND product_id = $2
         RETURNING *`,
        [userId, productId]
    );
    return result.rows[0];
};

exports.clearCart = async (userId) => {
    await pool.query(
        `DELETE FROM cart_items
         WHERE user_id = $1`,
        [userId]
    );
};

exports.syncCart = async (userId, localItems) => {
    if (!localItems || !Array.isArray(localItems)) return;

    for (const item of localItems) {
        await pool.query(
            `INSERT INTO cart_items (user_id, product_id, quantity, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (user_id, product_id)
             DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
            [userId, item.id, item.quantity]
        );
    }
};
