
const pool = require("../config/db");

exports.getAllProductTypes = async () => {
    const result = await pool.query("SELECT * FROM product_types ORDER BY name ASC");
    return result.rows.map(row => ({
        id: row.type_id.toString(),
        name: row.name,
        description: row.description
    }));
};

exports.createProductType = async (data) => {
    const { name, description } = data;
    constresult = await pool.query(
        "INSERT INTO product_types (name, description) VALUES ($1, $2) RETURNING *",
        [name, description]
    );
    const row = result.rows[0];
    return {
        id: row.type_id.toString(),
        name: row.name,
        description: row.description
    };
};

exports.updateProductType = async (id, data) => {
    const { name, description } = data;
    const result = await pool.query(
        "UPDATE product_types SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE type_id = $3 RETURNING *",
        [name, description, id]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
        id: row.type_id.toString(),
        name: row.name,
        description: row.description
    };
};

exports.deleteProductType = async (id) => {
    const result = await pool.query("DELETE FROM product_types WHERE type_id = $1 RETURNING *", [id]);
    return result.rows.length > 0;
};
