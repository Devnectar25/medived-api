const pool = require("../config/db");

exports.getAllCategories = async () => {
    const result = await pool.query("SELECT * FROM category");
    return result.rows;
};

exports.getActiveCategories = async () => {
    const result = await pool.query("SELECT * FROM category where active = true");
    return result.rows;
};

exports.getCategoryById = async (id) => {
    const result = await pool.query("SELECT * FROM category where srno = $1 and active = true", [id]);
    return result.rows[0];
};

exports.createCategory = async (data) => {
    const result = await pool.query("INSERT INTO category (name, description, active, image) VALUES ($1, $2, $3, $4) RETURNING *", [data.name, data.description, data.active, data.image]);
    return result.rows[0];
};

exports.updateCategory = async (id, data) => {
    const result = await pool.query("UPDATE category SET name = $2, description = $3, active = $4, image = $5 WHERE srno = $1 RETURNING *", [id, data.name, data.description, data.active, data.image]);
    return result.rows[0];
};

exports.deleteCategory = async (id) => {
    const result = await pool.query("DELETE FROM category WHERE srno = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.setActiveCategory = async (id) => {
    const result = await pool.query("UPDATE category SET active = true WHERE srno = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.setInactiveCategory = async (id) => {
    const result = await pool.query("UPDATE category SET active = false WHERE srno = $1 RETURNING *", [id]);
    return result.rows[0];
};
