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

exports.getAllSubcategories = async (page, limit) => {
    if (page && limit) {
        const offset = (page - 1) * limit;
        const countResult = await pool.query("SELECT COUNT(*) FROM subcategory");
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query(`
            SELECT s.*, c.name as category_name 
            FROM subcategory s 
            LEFT JOIN category c ON s.category_id = c.category_id 
            ORDER BY s.srno ASC 
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        return {
            data: result.rows.map(mapSubcategory),
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit)
        };
    }

    const result = await pool.query(`
        SELECT s.*, c.name as category_name 
        FROM subcategory s 
        LEFT JOIN category c ON s.category_id = c.category_id 
        ORDER BY s.srno ASC
    `);
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
    const { category_id, name, description, active } = data;
    const result = await pool.query(
        "INSERT INTO subcategory (category_id, name, description, active, createdate) VALUES ($1, $2, $3, $4, NOW()) RETURNING *",
        [category_id, name, description, active !== false]
    );
    return mapSubcategory(result.rows[0]);
};

exports.updateSubcategory = async (id, data) => {
    const { category_id, name, description, active } = data;
    const result = await pool.query(
        "UPDATE subcategory SET category_id = COALESCE($1, category_id), name = COALESCE($2, name), description = COALESCE($3, description), active = COALESCE($4, active) WHERE srno = $5 RETURNING *",
        [category_id, name, description, active, id]
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
