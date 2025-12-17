const pool = require("../config/db");

exports.getAllProducts = async () => {
    const result = await pool.query("SELECT * FROM product_ayurvedic");
    return result.rows;
};

exports.getProductById = async (id) => {
    const result = await pool.query(
        "SELECT * FROM product_ayurvedic WHERE sr_no = $1",
        [id.toString()]     // IMPORTANT
    );
    return result.rows[0];
};

exports.getActiveProducts = async () => {
    const result = await pool.query("SELECT * FROM product_ayurvedic where active = true");
    return result.rows;
};

exports.createProduct = async (product) => {
    const { product_name, description, price, stock, active } = product;
    const result = await pool.query(
        "INSERT INTO product_ayurvedic (product_name, description, price, stock, active) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [product_name, description, price, stock, active]
    );
    return result.rows[0];
};

exports.updateProduct = async (id, product) => {
    const { product_name, description, price, stock, active } = product;
    const result = await pool.query(
        "UPDATE product_ayurvedic SET product_name = $1, description = $2, price = $3, stock = $4, active = $5 WHERE sr_no = $6 RETURNING *",
        [product_name, description, price, stock, active, id.toString()]
    );
    return result.rows[0];
};

exports.deleteProduct = async (id) => {
    const result = await pool.query(
        "DELETE FROM product_ayurvedic WHERE sr_no = $1 RETURNING *",
        [id.toString()]
    );
    return result.rows[0];
};

exports.setActiveProduct = async (id) => {
    const result = await pool.query(
        "UPDATE product_ayurvedic SET active = true WHERE sr_no = $1 RETURNING *",
        [id.toString()]
    );
    return result.rows[0];
};

exports.setInactiveProduct = async (id) => {
    const result = await pool.query(
        "UPDATE product_ayurvedic SET active = false WHERE sr_no = $1 RETURNING *",
        [id.toString()]
    );
    return result.rows[0];
};
