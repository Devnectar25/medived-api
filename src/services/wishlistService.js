const pool = require('../config/db');

exports.addToWishlist = async (userId, productId) => {
    const result = await pool.query(
        'INSERT INTO wishlist (user_id, product_id) VALUES ($1, $2::integer) ON CONFLICT (user_id, product_id) DO NOTHING RETURNING *',
        [userId, productId]
    );
    return result.rows[0];
};

exports.getWishlistByUser = async (userId) => {
    const result = await pool.query(
        `SELECT w.*, p.productname, p.image, p.price, p.originalprice, p.instock, p.stock_quantity, p.quantity
         FROM wishlist w
         JOIN products p ON w.product_id = p.product_id
         WHERE w.user_id = $1
         ORDER BY w.created_at DESC`,
        [userId]
    );
    return result.rows.map(p => ({
        id: p.id,
        productId: p.product_id.toString(),
        productName: p.productname,
        productImage: p.image,
        productPrice: parseFloat(p.price),
        addedDate: p.created_at,
        inStock: p.instock,
        stockQuantity: p.stock_quantity || p.quantity || 0
    }));
};

exports.removeFromWishlist = async (userId, productId) => {
    const result = await pool.query(
        'DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2::integer RETURNING *',
        [userId, productId]
    );
    return result.rows[0];
};

exports.getWishlistCount = async (userId) => {
    const result = await pool.query(
        'SELECT COUNT(*) FROM wishlist WHERE user_id = $1',
        [userId]
    );
    return parseInt(result.rows[0].count);
};

exports.toggleWishlist = async (userId, productId) => {
    // Removes the item if present, otherwise adds it, in one statement
    const result = await pool.query(
        `WITH removed AS (
             DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2::integer RETURNING 1
         ), added AS (
             INSERT INTO wishlist (user_id, product_id)
             SELECT $1, $2::integer WHERE NOT EXISTS (SELECT 1 FROM removed)
             ON CONFLICT (user_id, product_id) DO NOTHING
         )
         SELECT NOT EXISTS (SELECT 1 FROM removed) AS added`,
        [userId, productId]
    );
    return { added: result.rows[0].added };
};
