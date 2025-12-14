const pool = require("../config/db");

exports.getAllBrands = async () => {
    const result = await pool.query("SELECT * FROM brand");
    return result.rows;
};
