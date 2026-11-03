const pool = require("../config/db");

exports.getAllCategories = async (optionsOrPage, maybeLimit, maybeSearch, maybeSortBy, maybeSortOrder, maybeActive) => {
    let page, limit, search, sortBy, sortOrder, active;
    if (optionsOrPage && typeof optionsOrPage === 'object') {
        page = optionsOrPage.page;
        limit = optionsOrPage.limit;
        search = optionsOrPage.search;
        sortBy = optionsOrPage.sortBy;
        sortOrder = optionsOrPage.sortOrder;
        active = optionsOrPage.active;
    } else {
        page = optionsOrPage;
        limit = maybeLimit;
        search = maybeSearch;
        sortBy = maybeSortBy;
        sortOrder = maybeSortOrder;
        active = maybeActive;
    }

    let whereClauses = [];
    let params = [];
    let paramIdx = 1;

    // Filter by search query (name or description)
    if (search && typeof search === 'string' && search.trim()) {
        const term = `%${search.trim()}%`;
        whereClauses.push(`(name ILIKE $${paramIdx} OR COALESCE(description, '') ILIKE $${paramIdx})`);
        params.push(term);
        paramIdx++;
    }

    // Filter by active status
    if (active !== undefined && active !== null && active !== '' && active !== 'all') {
        const isActive = active === true || active === 'true' || active === 1 || active === '1';
        whereClauses.push(`active = $${paramIdx}`);
        params.push(isActive);
        paramIdx++;
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Determine sorting
    const allowedSortFields = {
        name: 'LOWER(name)',
        createdate: 'createdate',
        category_id: 'category_id',
        active: 'active'
    };

    const sortField = allowedSortFields[sortBy] || 'category_id';
    const direction = (sortOrder && String(sortOrder).toLowerCase() === 'desc') ? 'DESC' : 'ASC';

    let orderClause = `ORDER BY ${sortField} ${direction}`;
    if (sortBy === 'active') {
        orderClause = `ORDER BY active ${direction}, LOWER(name) ASC`;
    } else if (sortBy === 'name') {
        orderClause = `ORDER BY LOWER(name) ${direction}, category_id ASC`;
    }

    if (page && limit) {
        const parsedPage = Math.max(1, parseInt(page) || 1);
        const parsedLimit = Math.max(1, parseInt(limit) || 10);
        const offset = (parsedPage - 1) * parsedLimit;

        const countResult = await pool.query(`SELECT COUNT(*) FROM category ${whereString}`, params);
        const total = parseInt(countResult.rows[0]?.count || 0);

        const dataParams = [...params, parsedLimit, offset];
        const dataResult = await pool.query(
            `SELECT * FROM category ${whereString} ${orderClause} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
            dataParams
        );

        return {
            data: dataResult.rows,
            total,
            page: parsedPage,
            limit: parsedLimit,
            totalPages: Math.ceil(total / parsedLimit) || 1
        };
    }

    const result = await pool.query(`SELECT * FROM category ${whereString} ${orderClause}`, params);
    return result.rows;
};

exports.getActiveCategories = async () => {
    const result = await pool.query(`
        SELECT c.*, COUNT(p.product_id)::int as product_count
        FROM category c
        LEFT JOIN products p ON c.category_id = p.category_id AND p.active = true
        WHERE c.active = true
        GROUP BY c.category_id
        ORDER BY c.name ASC
    `);
    return result.rows;
};

exports.getCategoryById = async (id) => {
    const result = await pool.query("SELECT * FROM category WHERE category_id = $1", [id]);
    return result.rows[0];
};

exports.createCategory = async (data) => {
    let { name, description, active, category_image } = data;
    name = (name || '').trim();

    // Check for duplicate category name (case-insensitive)
    const existing = await pool.query(
        "SELECT category_id, name FROM category WHERE LOWER(TRIM(name)) = LOWER($1)",
        [name]
    );

    if (existing.rows.length > 0) {
        const error = new Error(`Category "${name}" already exists.`);
        error.statusCode = 400;
        throw error;
    }

    const result = await pool.query(
        "INSERT INTO category (name, description, active, category_image, createdate) VALUES ($1, $2, $3, $4, NOW()) RETURNING *",
        [name, description, active, category_image]
    );
    return result.rows[0];
};

exports.updateCategory = async (id, data) => {
    let { name, description, active, category_image } = data;
    if (name !== undefined) {
        name = name.trim();
        // Check for duplicate category name with other categories
        const existing = await pool.query(
            "SELECT category_id, name FROM category WHERE LOWER(TRIM(name)) = LOWER($1) AND category_id != $2",
            [name, id]
        );

        if (existing.rows.length > 0) {
            const error = new Error(`Another category with the name "${name}" already exists.`);
            error.statusCode = 400;
            throw error;
        }
    }

    const result = await pool.query(
        "UPDATE category SET name = COALESCE($1, name), description = COALESCE($2, description), active = COALESCE($3, active), category_image = COALESCE($4, category_image) WHERE category_id = $5 RETURNING *",
        [name, description, active, category_image, id]
    );
    return result.rows[0];
};

exports.deleteCategory = async (id) => {
    const result = await pool.query("DELETE FROM category WHERE category_id = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.setActiveCategory = async (id) => {
    const result = await pool.query("UPDATE category SET active = true WHERE category_id = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.setInactiveCategory = async (id) => {
    const result = await pool.query("UPDATE category SET active = false WHERE category_id = $1 RETURNING *", [id]);
    return result.rows[0];
};
