const pool = require('../config/db');

exports.addToWishlist = async (userId, productId) => {
    const result = await pool.query(
        'INSERT INTO wishlist (user_id, product_id) VALUES ($1, $2) ON CONFLICT (user_id, product_id) DO NOTHING RETURNING *',
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
        'DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2 RETURNING *',
        [userId, productId]
    );
    return result.rows[0];
};
