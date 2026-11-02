const pool = require("../config/db");

const mapSubcategory = (s) => ({
    subcategory_id: s.srno,
    category_id: s.category_id,
    category_name: s.category_name,
    name: s.name,
    description: s.description,
    active: s.active,
    createdate: s.createdate
});

exports.getAllSubcategories = async (optionsOrPage, maybeLimit, maybeCategory, maybeSearch, maybeSortBy, maybeSortOrder, maybeActive) => {
    let page, limit, category_id, search, sortBy, sortOrder, active;
    if (optionsOrPage && typeof optionsOrPage === 'object') {
        page = optionsOrPage.page;
        limit = optionsOrPage.limit;
        category_id = optionsOrPage.category_id;
        search = optionsOrPage.search;
        sortBy = optionsOrPage.sortBy;
        sortOrder = optionsOrPage.sortOrder;
        active = optionsOrPage.active;
    } else {
        page = optionsOrPage;
        limit = maybeLimit;
        category_id = maybeCategory;
        search = maybeSearch;
        sortBy = maybeSortBy;
        sortOrder = maybeSortOrder;
        active = maybeActive;
    }

    let whereClauses = [];
    let params = [];
    let paramIdx = 1;

    // Filter by parent category_id
    if (category_id && category_id !== 'all' && !isNaN(parseInt(category_id))) {
        whereClauses.push(`s.category_id = $${paramIdx}`);
        params.push(parseInt(category_id));
        paramIdx++;
    }

    // Filter by search query (name, description, or parent category name)
    if (search && typeof search === 'string' && search.trim()) {
        const term = `%${search.trim()}%`;
        whereClauses.push(`(s.name ILIKE $${paramIdx} OR COALESCE(s.description, '') ILIKE $${paramIdx} OR c.name ILIKE $${paramIdx})`);
        params.push(term);
        paramIdx++;
    }

    // Filter by active status
    if (active !== undefined && active !== null && active !== '' && active !== 'all') {
        const isActive = active === true || active === 'true' || active === 1 || active === '1';
        whereClauses.push(`s.active = $${paramIdx}`);
        params.push(isActive);
        paramIdx++;
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Determine sorting
    const allowedSortFields = {
        name: 'LOWER(s.name)',
        category_name: 'LOWER(c.name)',
        createdate: 's.createdate',
        srno: 's.srno',
        active: 's.active'
    };

    const sortField = allowedSortFields[sortBy] || 's.srno';
    const direction = (sortOrder && String(sortOrder).toLowerCase() === 'desc') ? 'DESC' : 'ASC';

    let orderClause = `ORDER BY ${sortField} ${direction}`;
    if (sortBy === 'active') {
        orderClause = `ORDER BY s.active ${direction}, LOWER(s.name) ASC`;
    } else if (sortBy === 'name') {
        orderClause = `ORDER BY LOWER(s.name) ${direction}, s.srno ASC`;
    } else if (sortBy === 'category_name') {
        orderClause = `ORDER BY LOWER(c.name) ${direction}, LOWER(s.name) ASC`;
    }

    if (page && limit) {
        const parsedPage = Math.max(1, parseInt(page) || 1);
        const parsedLimit = Math.max(1, parseInt(limit) || 10);
        const offset = (parsedPage - 1) * parsedLimit;

        const countQuery = `
            SELECT COUNT(*) 
            FROM subcategory s 
            LEFT JOIN category c ON s.category_id = c.category_id 
            ${whereString}
        `;
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0]?.count || 0);

        const dataParams = [...params, parsedLimit, offset];
        const dataQuery = `
            SELECT s.*, c.name as category_name 
            FROM subcategory s 
            LEFT JOIN category c ON s.category_id = c.category_id 
            ${whereString} 
            ${orderClause} 
            LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `;
        const dataResult = await pool.query(dataQuery, dataParams);

        return {
            data: dataResult.rows.map(mapSubcategory),
            total,
            page: parsedPage,
            limit: parsedLimit,
            totalPages: Math.ceil(total / parsedLimit) || 1
        };
    }

    const result = await pool.query(`
        SELECT s.*, c.name as category_name 
        FROM subcategory s 
        LEFT JOIN category c ON s.category_id = c.category_id 
        ${whereString} 
        ${orderClause}
    `, params);
    return result.rows.map(mapSubcategory);
};

exports.getActiveSubcategories = async () => {
    const result = await pool.query(`
        SELECT s.*, c.name as category_name 
        FROM subcategory s 
        LEFT JOIN category c ON s.category_id = c.category_id 
        WHERE s.active = true 
        ORDER BY s.name ASC
    `);
    return result.rows.map(mapSubcategory);
};

exports.getSubcategoryById = async (id) => {
    const result = await pool.query(`
        SELECT s.*, c.name as category_name 
        FROM subcategory s 
        LEFT JOIN category c ON s.category_id = c.category_id 
        WHERE s.srno = $1
    `, [id]);
    return result.rows[0] ? mapSubcategory(result.rows[0]) : null;
};

exports.getSubcategoriesBycategory_id = async (category_id) => {
    const result = await pool.query(`
        SELECT s.*, c.name as category_name 
        FROM subcategory s 
        LEFT JOIN category c ON s.category_id = c.category_id 
        WHERE s.category_id = $1 AND s.active = true 
        ORDER BY s.name ASC
    `, [category_id]);
    return result.rows.map(mapSubcategory);
};

exports.createSubcategory = async (data) => {
    let { category_id, name, description, active } = data;
    name = (name || '').trim();
    const catId = parseInt(category_id, 10);

    if (!catId) {
        const error = new Error("Parent category is required.");
        error.statusCode = 400;
        throw error;
    }

    if (!name) {
        const error = new Error("Subcategory name is required.");
        error.statusCode = 400;
        throw error;
    }

    // Check for duplicate subcategory under the same parent category (case-insensitive & trimmed)
    const existing = await pool.query(
        "SELECT srno, name FROM subcategory WHERE category_id = $1 AND LOWER(TRIM(name)) = LOWER($2)",
        [catId, name]
    );

    if (existing.rows.length > 0) {
        const error = new Error(`Subcategory "${name}" already exists under this category.`);
        error.statusCode = 400;
        throw error;
    }

    const result = await pool.query(
        "INSERT INTO subcategory (category_id, name, description, active, createdate) VALUES ($1, $2, $3, $4, NOW()) RETURNING *",
        [catId, name, description, active !== false]
    );
    return mapSubcategory(result.rows[0]);
};

exports.updateSubcategory = async (id, data) => {
    let { category_id, name, description, active } = data;
    const subcategoryId = parseInt(id, 10);

    // Fetch existing subcategory to know current category_id and name if not provided
    const currentSub = await pool.query("SELECT srno, category_id, name FROM subcategory WHERE srno = $1", [subcategoryId]);
    if (currentSub.rows.length === 0) {
        return null;
    }

    const targetCategoryId = category_id !== undefined ? parseInt(category_id, 10) : currentSub.rows[0].category_id;
    const targetName = name !== undefined ? name.trim() : (currentSub.rows[0].name || '').trim();

    if (name !== undefined && !targetName) {
        const error = new Error("Subcategory name cannot be empty.");
        error.statusCode = 400;
        throw error;
    }

    // Check for duplicate under target category excluding the current subcategory
    const existing = await pool.query(
        "SELECT srno, name FROM subcategory WHERE category_id = $1 AND LOWER(TRIM(name)) = LOWER($2) AND srno != $3",
        [targetCategoryId, targetName, subcategoryId]
    );

    if (existing.rows.length > 0) {
        const error = new Error(`Another subcategory with the name "${targetName}" already exists under this category.`);
        error.statusCode = 400;
        throw error;
    }

    const result = await pool.query(
        "UPDATE subcategory SET category_id = COALESCE($1, category_id), name = COALESCE($2, name), description = COALESCE($3, description), active = COALESCE($4, active) WHERE srno = $5 RETURNING *",
        [category_id !== undefined ? targetCategoryId : null, name !== undefined ? targetName : null, description, active, subcategoryId]
    );
    return result.rows[0] ? mapSubcategory(result.rows[0]) : null;
};

exports.deleteSubcategory = async (id) => {
    const result = await pool.query("DELETE FROM subcategory WHERE srno = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.setActiveSubcategory = async (id) => {
    const result = await pool.query("UPDATE subcategory SET active = true WHERE srno = $1 RETURNING *", [id]);
    return result.rows[0] ? mapSubcategory(result.rows[0]) : null;
};

exports.setInactiveSubcategory = async (id) => {
    const result = await pool.query("UPDATE subcategory SET active = false WHERE srno = $1 RETURNING *", [id]);
    return result.rows[0] ? mapSubcategory(result.rows[0]) : null;
};
