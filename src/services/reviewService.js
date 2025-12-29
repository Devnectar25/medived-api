const pool = require("../config/db");

exports.getReviewsByProduct = async (productId) => {
    const result = await pool.query(
        `SELECT r.*, u.username as user_name
         FROM review r
         LEFT JOIN users u ON r.username = u.username
         WHERE r.productid = $1
         ORDER BY r.date DESC`,
        [productId]
    );

    return result.rows.map(row => ({
        id: row.srno,
        user: row.user_name || row.username || 'Anonymous',
        rating: row.rating,
        comment: row.review,
        date: row.date,
        verified: true
    }));
};

exports.createReview = async (data) => {
    const { productId, username, rating, review } = data;

    // Ensure user exists to satisfy FK constraint
    let validUser = username;
    const userCheck = await pool.query("SELECT username FROM users WHERE username = $1", [username]);

    if (userCheck.rows.length === 0) {
        try {
            // Create the user on the fly to satisfy constraint
            const email = `${(username || 'guest').toLowerCase().replace(/\s+/g, '')}@example.com`;
            await pool.query(
                "INSERT INTO users (username, emailid, password, active) VALUES ($1, $2, 'guest123', true)",
                [username || 'guest', email]
            );
        } catch (userErr) {
            console.warn("Could not create new user, falling back to existing:", userErr.message);
            // Fallback to the first available user
            const anyUser = await pool.query("SELECT username FROM users LIMIT 1");
            if (anyUser.rows.length > 0) {
                validUser = anyUser.rows[0].username;
            } else {
                throw new Error("Cannot create review: No valid user found.");
            }
        }
    }

    const result = await pool.query(
        `INSERT INTO review (productid, username, rating, review, date)
         VALUES ($1, $2, $3, $4, CURRENT_DATE)
         RETURNING *`,
        [productId, validUser, rating, review]
    );

    // Update product rating and review count
    await pool.query(
        `UPDATE products 
         SET rating = (SELECT AVG(rating) FROM review WHERE productid = $1),
             reviews = (SELECT COUNT(*)::text FROM review WHERE productid = $1)
         WHERE product_id = $1`,
        [productId]
    );

    return result.rows[0];
};

exports.getReviewSummary = async (productId) => {
    const result = await pool.query(
        `SELECT rating, COUNT(*) as count
         FROM review
         WHERE productid = $1
         GROUP BY rating`,
        [productId]
    );

    const distribution = {
        5: 0, 4: 0, 3: 0, 2: 0, 1: 0
    };

    let totalReviews = 0;
    let totalRating = 0;

    result.rows.forEach(row => {
        const r = parseInt(row.rating);
        const c = parseInt(row.count);
        if (distribution[r] !== undefined) {
            distribution[r] = c;
        }
        totalReviews += c;
        totalRating += (r * c);
    });

    const average = totalReviews > 0 ? (totalRating / totalReviews).toFixed(1) : 0;

    return {
        average,
        total: totalReviews,
        distribution
    };
};
