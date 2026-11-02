const pool = require("../config/db");

exports.getReviewsByProduct = async (productId) => {
    const result = await pool.query(
        `SELECT r.*, u.username as user_name, u.fullname
         FROM review r
         LEFT JOIN users u ON r.username = u.username OR r.username = u.emailid
         WHERE r.productid = $1
         ORDER BY r.date DESC`,
        [productId]
    );

    return result.rows.map(row => {
        let displayName = row.fullname && !row.fullname.includes('@')
            ? row.fullname
            : (row.user_name || row.username || 'Anonymous');

        if (displayName && displayName.includes('@')) {
            displayName = displayName.split('@')[0];
        }

        return {
            id: row.srno,
            user: displayName,
            rating: parseFloat(row.rating) || 5,
            comment: row.review,
            date: row.date,
            verified: true
        };
    });
};

exports.createReview = async (data) => {
    const { productId, username, rating, review } = data;

    // Ensure user exists to satisfy FK constraint
    let validUser = username;
    const userCheck = await pool.query("SELECT username FROM users WHERE username = $1 OR emailid = $1", [username]);

    if (userCheck.rows.length > 0) {
        validUser = userCheck.rows[0].username;
    } else {
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

    // Check if the user has already rated/reviewed this product - if so, update their feedback
    const existingCheck = await pool.query(
        "SELECT srno FROM review WHERE productid = $1 AND username = $2",
        [productId, validUser]
    );

    if (existingCheck.rows.length > 0) {
        const updateResult = await pool.query(
            `UPDATE review 
             SET rating = $1, review = $2, date = CURRENT_DATE 
             WHERE srno = $3 
             RETURNING *`,
            [rating, review, existingCheck.rows[0].srno]
        );

        // Update product rating and review count
        await pool.query(
            `UPDATE products 
             SET rating = (SELECT AVG(rating::numeric) FROM review WHERE productid = $1),
                 reviews = (SELECT COUNT(*)::text FROM review WHERE productid = $1)
             WHERE product_id = $1`,
            [productId]
        );

        return updateResult.rows[0];
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
         SET rating = (SELECT AVG(rating::numeric) FROM review WHERE productid = $1),
             reviews = (SELECT COUNT(*)::text FROM review WHERE productid = $1)
         WHERE product_id = $1`,
        [productId]
    );

    return result.rows[0];
};

exports.getReviewSummary = async (productId) => {
    const result = await pool.query(
        `SELECT ROUND(rating::numeric) as rating, COUNT(*) as count
         FROM review
         WHERE productid = $1
         GROUP BY ROUND(rating::numeric)`,
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

exports.getAllReviews = async (options = {}) => {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(options.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const whereConditions = [];
    const params = [];
    let paramIdx = 1;

    if (options.search && typeof options.search === 'string' && options.search.trim()) {
        const term = `%${options.search.trim()}%`;
        params.push(term);
        whereConditions.push(`(
            r.review ILIKE $${paramIdx} 
            OR r.username ILIKE $${paramIdx} 
            OR p.productname ILIKE $${paramIdx} 
            OR u.fullname ILIKE $${paramIdx} 
            OR u.emailid ILIKE $${paramIdx}
        )`);
        paramIdx++;
    }

    if (options.rating && options.rating !== 'all') {
        const ratingNum = parseInt(options.rating, 10);
        if (!isNaN(ratingNum) && ratingNum >= 1 && ratingNum <= 5) {
            params.push(ratingNum);
            whereConditions.push(`ROUND(r.rating::numeric) = $${paramIdx}`);
            paramIdx++;
        }
    }

    if (options.productId) {
        const prodId = parseInt(options.productId, 10);
        if (!isNaN(prodId)) {
            params.push(prodId);
            whereConditions.push(`r.productid = $${paramIdx}`);
            paramIdx++;
        }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Count query
    const countQuery = `
        SELECT COUNT(*) as total
        FROM review r
        LEFT JOIN products p ON r.productid = p.product_id
        LEFT JOIN users u ON r.username = u.username OR r.username = u.emailid
        ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    // Sorting
    let orderByClause = 'r.date DESC, r.srno DESC';
    const sortOrder = options.sortOrder?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    if (options.sortBy === 'rating') {
        orderByClause = `r.rating::numeric ${sortOrder}, r.date DESC`;
    } else if (options.sortBy === 'product' || options.sortBy === 'product_name') {
        orderByClause = `p.productname ${sortOrder} NULLS LAST, r.date DESC`;
    } else if (options.sortBy === 'date') {
        orderByClause = `r.date ${sortOrder}, r.srno ${sortOrder}`;
    } else if (options.sortBy === 'id' || options.sortBy === 'srno') {
        orderByClause = `r.srno ${sortOrder}`;
    }

    // Pagination query
    const queryParams = [...params, limit, offset];
    const dataQuery = `
        SELECT 
            r.srno,
            r.productid,
            r.username,
            r.rating,
            r.review,
            r.date,
            p.productname as product_name,
            p.image as product_image,
            p.price as product_price,
            u.fullname as user_fullname,
            u.emailid as user_email
        FROM review r
        LEFT JOIN products p ON r.productid = p.product_id
        LEFT JOIN users u ON r.username = u.username OR r.username = u.emailid
        ${whereClause}
        ORDER BY ${orderByClause}
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;

    const dataResult = await pool.query(dataQuery, queryParams);

    const formattedReviews = dataResult.rows.map(row => {
        let displayName = row.user_fullname && !row.user_fullname.includes('@')
            ? row.user_fullname
            : (row.username || 'Customer');

        if (displayName && displayName.includes('@')) {
            displayName = displayName.split('@')[0];
        }

        return {
            id: row.srno,
            srno: row.srno,
            productId: row.productid,
            productName: row.product_name || `Product #${row.productid}`,
            productImage: row.product_image || '',
            productPrice: row.product_price || 0,
            username: row.username,
            reviewerName: displayName,
            reviewerEmail: row.user_email || (row.username && row.username.includes('@') ? row.username : ''),
            rating: parseFloat(row.rating) || 5,
            review: row.review || '',
            date: row.date,
        };
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return {
        data: formattedReviews,
        total,
        page,
        limit,
        totalPages
    };
};

exports.getOverallReviewStats = async () => {
    const statsQuery = `
        SELECT 
            COUNT(*)::int as total,
            COALESCE(ROUND(AVG(rating::numeric)::numeric, 1), 0) as average,
            COUNT(*) FILTER (WHERE ROUND(rating::numeric) = 5)::int as stars_5,
            COUNT(*) FILTER (WHERE ROUND(rating::numeric) = 4)::int as stars_4,
            COUNT(*) FILTER (WHERE ROUND(rating::numeric) = 3)::int as stars_3,
            COUNT(*) FILTER (WHERE ROUND(rating::numeric) = 2)::int as stars_2,
            COUNT(*) FILTER (WHERE ROUND(rating::numeric) = 1)::int as stars_1,
            COUNT(DISTINCT productid)::int as reviewed_products
        FROM review
    `;
    const result = await pool.query(statsQuery);
    const row = result.rows[0] || {};

    const total = parseInt(row.total || 0, 10);
    const stars5 = parseInt(row.stars_5 || 0, 10);
    const stars4 = parseInt(row.stars_4 || 0, 10);
    const stars3 = parseInt(row.stars_3 || 0, 10);
    const stars2 = parseInt(row.stars_2 || 0, 10);
    const stars1 = parseInt(row.stars_1 || 0, 10);

    return {
        totalReviews: total,
        averageRating: Number(row.average || 0),
        reviewedProducts: parseInt(row.reviewed_products || 0, 10),
        distribution: {
            5: stars5,
            4: stars4,
            3: stars3,
            2: stars2,
            1: stars1,
        },
        positiveCount: stars5 + stars4,
        neutralCount: stars3,
        negativeCount: stars2 + stars1,
    };
};

exports.deleteReview = async (id) => {
    const findRes = await pool.query("SELECT srno, productid FROM review WHERE srno = $1", [id]);
    if (findRes.rows.length === 0) {
        return null;
    }

    const { productid } = findRes.rows[0];

    await pool.query("DELETE FROM review WHERE srno = $1", [id]);

    await pool.query(
        `UPDATE products 
         SET rating = COALESCE((SELECT AVG(rating::numeric) FROM review WHERE productid = $1), 0),
             reviews = (SELECT COUNT(*)::text FROM review WHERE productid = $1)
         WHERE product_id = $1`,
        [productid]
    );

    return {
        id,
        productId: productid
    };
};
