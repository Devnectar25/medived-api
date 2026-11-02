const pool = require("../config/db");

exports.getAllBrands = async (optionsOrPage, maybeLimit, maybeSearch, maybeSortBy, maybeSortOrder, maybeActive) => {
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
        brand_id: 'brand_id',
        active: 'active'
    };

    const sortField = allowedSortFields[sortBy] || 'brand_id';
    const direction = (sortOrder && String(sortOrder).toLowerCase() === 'desc') ? 'DESC' : 'ASC';

    let orderClause = `ORDER BY ${sortField} ${direction}`;
    if (sortBy === 'active') {
        orderClause = `ORDER BY active ${direction}, LOWER(name) ASC`;
    } else if (sortBy === 'name') {
        orderClause = `ORDER BY LOWER(name) ${direction}, brand_id ASC`;
    }

    if (page && limit) {
        const parsedPage = Math.max(1, parseInt(page) || 1);
        const parsedLimit = Math.max(1, parseInt(limit) || 10);
        const offset = (parsedPage - 1) * parsedLimit;

        const countResult = await pool.query(`SELECT COUNT(*) FROM brand ${whereString}`, params);
        const total = parseInt(countResult.rows[0]?.count || 0);

        const dataParams = [...params, parsedLimit, offset];
        const dataResult = await pool.query(
            `SELECT * FROM brand ${whereString} ${orderClause} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
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

    const result = await pool.query(`SELECT * FROM brand ${whereString} ${orderClause}`, params);
    return result.rows;
};

exports.getActiveBrands = async () => {
    const result = await pool.query("SELECT * FROM brand WHERE active = true ORDER BY brand_id");
    return result.rows;
};

exports.getBrandById = async (id) => {
    const result = await pool.query("SELECT * FROM brand WHERE brand_id = $1", [id]);
    return result.rows[0];
};

exports.createBrand = async (data) => {
    const { name, description, active, brand_logo } = data;
    const result = await pool.query(
        "INSERT INTO brand (name, description, active, brand_logo, createdate) VALUES ($1, $2, $3, $4, NOW()) RETURNING *",
        [name, description, active, brand_logo]
    );
    return result.rows[0];
};

exports.updateBrand = async (id, data) => {
    // Dynamically build the set clause to allow partial updates if needed, though mostly all fields are sent
    // But for this specific request, we update all allowed fields.
    const { name, description, active, brand_logo } = data;
    const result = await pool.query(
        "UPDATE brand SET name = $2, description = $3, active = $4, brand_logo = $5 WHERE brand_id = $1 RETURNING *",
        [id, name, description, active, brand_logo]
    );
    return result.rows[0];
};

exports.deleteBrand = async (id) => {
    const result = await pool.query("DELETE FROM brand WHERE brand_id = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.setActiveBrand = async (id) => {
    const result = await pool.query("UPDATE brand SET active = true WHERE brand_id = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.setInactiveBrand = async (id) => {
    const result = await pool.query("UPDATE brand SET active = false WHERE brand_id = $1 RETURNING *", [id]);
    return result.rows[0];
};

// Kept this for backward usage if needed, but it essentially just does a DB update of the logo column
exports.updateBrandLogo = async (id, logoUrl) => {
    const result = await pool.query("UPDATE brand SET brand_logo = $2 WHERE brand_id = $1 RETURNING *", [id, logoUrl]);
    return result.rows[0];
};
