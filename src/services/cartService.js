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
            p.brand        AS brand_id,
            p.stock_quantity,
            p.instock,
            cat.name       AS category_name,
            b.name         AS brand_name
         FROM cart_items c
         JOIN products p ON c.product_id = p.product_id
         LEFT JOIN category cat ON p.category_id = cat.category_id
         LEFT JOIN brand b ON p.brand = b.brand_id
         WHERE c.user_id = $1`,
        [userId]
    );
    return result.rows.map(item => ({
        ...item,
        id: item.product_id.toString(), // HOM-129: Consistent ID for UI (always Product ID)
        productId: item.product_id.toString(),
        cartItemId: item.id, // Keep DB ID if needed for debugging
        name: item.name,
        brand: item.brand_name || 'Homved',
        category: item.category_name || 'Uncategorized',
        price: parseFloat(item.price),
        originalPrice: parseFloat(item.originalprice),
        discount: parseFloat(item.discount),
        category_id: item.category_id ?? null,
        brand_id: item.brand_id ?? null,
        stockQuantity: item.stock_quantity !== null && item.stock_quantity !== undefined ? parseInt(item.stock_quantity) : null,
        inStock: item.instock ?? true
    }));
};

exports.addToCart = async (userId, productId, quantity, setMode = false) => {
    // HOM-11: If setMode is true, we reset the quantity to exactly 'quantity' (usually 1)
    // instead of incrementing. This supports modern Reorder and Buy Now behaviors.
    const result = await pool.query(
        `INSERT INTO cart_items (user_id, product_id, quantity, updated_at)
         SELECT $1, $2, $3, NOW()
         FROM products p WHERE p.product_id = $2
         ON CONFLICT (user_id, product_id)
         DO UPDATE SET 
            quantity = CASE WHEN $4 THEN EXCLUDED.quantity ELSE (SELECT LEAST(cart_items.quantity + EXCLUDED.quantity, p2.stock_quantity) FROM products p2 WHERE p2.product_id = cart_items.product_id) END, 
            updated_at = NOW()
         RETURNING *`,
        [userId, productId, quantity, setMode]
    );
    return result.rows[0];
};

exports.updateQuantity = async (userId, productId, quantity) => {
    // HOM-129: Cap quantity at available stock
    const result = await pool.query(
        `UPDATE cart_items
         SET quantity = LEAST($3, (SELECT stock_quantity FROM products WHERE product_id = $2)), 
             updated_at = NOW()
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
        // HOM-129: Ensure sync respects stock
        await pool.query(
            `INSERT INTO cart_items (user_id, product_id, quantity, updated_at)
             SELECT $1, $2, LEAST($3, p.stock_quantity), NOW()
             FROM products p WHERE p.product_id = $2
             ON CONFLICT (user_id, product_id)
             DO UPDATE SET 
                quantity = LEAST(EXCLUDED.quantity, (SELECT stock_quantity FROM products WHERE product_id = cart_items.product_id)), 
                updated_at = NOW()`,
            [userId, item.id, item.quantity]
        );
    }
};
