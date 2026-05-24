const pool = require('../config/db');

exports.submitContactForm = async (req, res) => {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
        return res.status(400).json({
            success: false,
            error: "All fields are required"
        });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            success: false,
            error: "Invalid email format"
        });
    }

    try {
        const query = `
            INSERT INTO contact_submissions (name, email, subject, message)
            VALUES ($1, $2, $3, $4)
            RETURNING id, created_at
        `;

        const result = await pool.query(query, [name, email, subject, message]);

        res.status(201).json({
            success: true,
            message: "Message sent successfully",
            data: result.rows[0]
        });

    } catch (err) {
        console.error("Error submitting contact form:", err);
        res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
};

exports.getAllLeads = async (req, res) => {
    try {
        const query = `
            SELECT id, name, email, subject, message, created_at
            FROM contact_submissions
            ORDER BY created_at DESC
        `;
        const result = await pool.query(query);

        res.status(200).json({
            success: true,
            data: result.rows
        });
    } catch (err) {
        console.error("Error fetching leads:", err);
        res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
};
