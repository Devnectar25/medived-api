import pool from "../config/db";

export class BrandDao {
    static async getAllBrands() {
        const result = await pool.query("SELECT * FROM brand");
        return result.rows;
    }
}
