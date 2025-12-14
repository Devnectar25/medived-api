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

