const pool = require("../config/db");

exports.getAllCategories = async () => {
    const result = await pool.query("SELECT * FROM category ORDER BY category_id ASC");
    return result.rows;
};

exports.getActiveCategories = async () => {
    const result = await pool.query("SELECT * FROM category WHERE active = true ORDER BY name ASC");
    return result.rows;
};

exports.getCategoryById = async (id) => {
    const result = await pool.query("SELECT * FROM category WHERE category_id = $1", [id]);
    return result.rows[0];
};

exports.createCategory = async (data) => {
    const { name, description, active, category_image } = data;
    const result = await pool.query(
        "INSERT INTO category (name, description, active, category_image, createdate) VALUES ($1, $2, $3, $4, NOW()) RETURNING *",
        [name, description, active, category_image]
    );
    return result.rows[0];
};

exports.updateCategory = async (id, data) => {
    const { name, description, active, category_image } = data;
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
