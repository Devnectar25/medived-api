const pool = require("../config/db");

exports.getAllBrands = async (page, limit) => {
    if (page && limit) {
        const offset = (page - 1) * limit;
        const countResult = await pool.query("SELECT COUNT(*) FROM brand");
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query("SELECT * FROM brand ORDER BY brand_id LIMIT $1 OFFSET $2", [limit, offset]);

        return {
            data: result.rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit)
        };
    }

    const result = await pool.query("SELECT * FROM brand ORDER BY brand_id");
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
