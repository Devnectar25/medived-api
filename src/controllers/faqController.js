const pool = require('../config/db');

exports.getAllFAQs = async (req, res) => {
    try {
        const query = `
            SELECT * FROM faqs 
            WHERE is_active = true 
            ORDER BY display_order ASC, id ASC
        `;
        const result = await pool.query(query);

        // Deduplicate and group by category
        const seenQuestions = new Set();
        const uniqueRows = [];
        const grouped = {};

        for (const faq of result.rows) {
            const key = `${(faq.category || 'General').toLowerCase()}___${faq.question.trim().toLowerCase()}`;
            if (!seenQuestions.has(key)) {
                seenQuestions.add(key);
                uniqueRows.push(faq);

                const cat = faq.category || 'General';
                if (!grouped[cat]) {
                    grouped[cat] = [];
                }
                grouped[cat].push(faq);
            }
        }

        res.status(200).json({
            success: true,
            data: grouped,
            all: uniqueRows
        });

    } catch (err) {
        console.error("Error fetching FAQs:", err);
        res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
};

exports.createFAQ = async (req, res) => {
    // Basic admin create functionality for future use
    const { question, answer, category, display_order } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO faqs (question, answer, category, display_order) VALUES ($1, $2, $3, $4) RETURNING *",
            [question, answer, category || 'General', display_order || 0]
        );
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
