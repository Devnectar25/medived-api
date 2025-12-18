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
    const result = await pool.query("SELECT * FROM brand where srno = $1 and active = true", [id]);
    return result.rows[0];
};

exports.createBrand = async (data) => {
    const result = await pool.query("INSERT INTO brand (name, brand_logo, active) VALUES ($1, $2, $3) RETURNING *", [data.name, data.brand_logo, data.active]);
    return result.rows[0];
};
exports.updateBrand = async (id, data) => {
    const result = await pool.query("UPDATE brand SET name = $2, brand_logo = $3, active = $4 WHERE srno = $1 RETURNING *", [id, data.name, data.brand_logo, data.active]);
    return result.rows[0];
};

exports.deleteBrand = async (id) => {
    const result = await pool.query("DELETE FROM brand WHERE srno = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.setActiveBrand = async (id) => {
    const result = await pool.query("UPDATE brand SET active = true WHERE srno = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.setInactiveBrand = async (id) => {
    const result = await pool.query("UPDATE brand SET active = false WHERE srno = $1 RETURNING *", [id]);
    return result.rows[0];
};
