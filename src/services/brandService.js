const pool = require("../config/db");

exports.getAllBrands = async () => {
    const result = await pool.query("SELECT * FROM brand");
    return result.rows;
};

exports.getActiveBrands = async () => {
    const result = await pool.query("SELECT * FROM brand where active = true");
    return result.rows;
};

exports.getBrandById = async (id) => {
    const result = await pool.query("SELECT * FROM brand where id = $1 and active = true", [id]);
    return result.rows[0];
};

exports.createBrand = async (brand) => {
    const result = await pool.query("INSERT INTO brand (name, logo, active) VALUES ($1, $2, $3) RETURNING *", [brand.name, brand.logo, brand.active]);
    return result.rows[0];
};

exports.updateBrand = async (id, brand) => {
    const result = await pool.query("UPDATE brand SET name = $2, logo = $3, active = $4 WHERE id = $1 RETURNING *", [id, brand.name, brand.logo, brand.active]);
    return result.rows[0];
};

exports.deleteBrand = async (id) => {
    const result = await pool.query("DELETE FROM brand WHERE id = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.setActiveBrand = async (id) => {
    const result = await pool.query("UPDATE brand SET active = true WHERE id = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.setInactiveBrand = async (id) => {
    const result = await pool.query("UPDATE brand SET active = false WHERE id = $1 RETURNING *", [id]);
    return result.rows[0];
};
