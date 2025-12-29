const pool = require("../config/db");
const storageService = require("./storageService");

const mapHealthTip = (t) => ({
    id: t.id,
    title: t.title,
    excerpt: t.excerpt,
    image: t.image,
    date: t.date,
    readTime: t.read_time,
    author: t.author,
    category: t.category,
    content: t.content,
    active: t.active,
    createdAt: t.created_at,
    updatedAt: t.updated_at
});

exports.getAllHealthTips = async (page, limit) => {
    if (page && limit) {
        const offset = (page - 1) * limit;
        const countResult = await pool.query("SELECT COUNT(*) FROM health_tips");
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query("SELECT * FROM health_tips ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);

        return {
            data: result.rows.map(mapHealthTip),
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit)
        };
    }

    const result = await pool.query("SELECT * FROM health_tips ORDER BY created_at DESC");
    return result.rows.map(mapHealthTip);
};

exports.getHealthTipById = async (id) => {
    const result = await pool.query("SELECT * FROM health_tips WHERE id = $1", [id]);
    return result.rows[0] ? mapHealthTip(result.rows[0]) : null;
};

exports.createHealthTip = async (data) => {
    const { title, excerpt, image, date, readTime, author, category, content, active } = data;
    const result = await pool.query(
        "INSERT INTO health_tips (title, excerpt, image, date, read_time, author, category, content, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
        [title, excerpt, image, date, readTime, author, category, content, active !== false]
    );
    return mapHealthTip(result.rows[0]);
};

exports.updateHealthTip = async (id, data) => {
    const { title, excerpt, image, date, readTime, author, category, content, active } = data;
    const result = await pool.query(
        "UPDATE health_tips SET title = $1, excerpt = $2, image = $3, date = $4, read_time = $5, author = $6, category = $7, content = $8, active = $9, updated_at = NOW() WHERE id = $10 RETURNING *",
        [title, excerpt, image, date, readTime, author, category, content, active !== false, id]
    );
    return result.rows[0] ? mapHealthTip(result.rows[0]) : null;
};

exports.deleteHealthTip = async (id) => {
    // 1. Get tip to find image URL
    const tipResult = await pool.query("SELECT image FROM health_tips WHERE id = $1", [id]);
    const tip = tipResult.rows[0];

    // 2. Delete image from Supabase if exists
    if (tip && tip.image) {
        try {
            await storageService.deleteImage(tip.image);
        } catch (error) {
            console.error("Error deleting health tip image from Supabase:", error);
        }
    }

    // 3. Delete record from DB
    const result = await pool.query("DELETE FROM health_tips WHERE id = $1 RETURNING *", [id]);
    return result.rows[0];
};

exports.getActiveHealthTips = async () => {
    const result = await pool.query("SELECT * FROM health_tips WHERE active = true ORDER BY created_at DESC");
    return result.rows.map(mapHealthTip);
};

exports.setActiveHealthTip = async (id) => {
    const result = await pool.query("UPDATE health_tips SET active = true WHERE id = $1 RETURNING *", [id]);
    return result.rows[0] ? mapHealthTip(result.rows[0]) : null;
};

exports.setInactiveHealthTip = async (id) => {
    const result = await pool.query("UPDATE health_tips SET active = false WHERE id = $1 RETURNING *", [id]);
    return result.rows[0] ? mapHealthTip(result.rows[0]) : null;
};
