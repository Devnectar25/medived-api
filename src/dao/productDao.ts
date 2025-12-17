import pool from "../config/db";

export class ProductDao {
    static async getAllProducts() {
        const result = await pool.query("SELECT * FROM product_ayurvedic");
        return result.rows;
    }

    static async getProductById(id: string | number) {
        const result = await pool.query(
            "SELECT * FROM product_ayurvedic WHERE sr_no = $1",
            [id.toString()]
        );
        return result.rows[0];
    }
}
