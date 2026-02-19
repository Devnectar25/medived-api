const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

router.get('/tables', async (req, res) => {
    try {
        const result = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        res.json({ success: true, tables: result.rows.map(r => r.table_name) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/setup-admin', async (req, res) => {
    try {
        // Force update existing Admin user's password and permissions
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('Admin', salt);

        // This query updates assuming the user exists (as confirmed by check)
        const updateResult = await pool.query(
            "UPDATE public.admins SET password = $1, accesstopage = $2, active = $3 WHERE userid = 'Admin' RETURNING adminid, userid, accesstopage, createdate, active",
            [hashedPassword, ['dashboard', 'orders', 'products', 'users', 'categories', 'brands', 'health-tips', 'subcategories', 'offers', 'faqs', 'contact', 'reviews', 'addresses', 'wishlist', 'cart', 'analytics'], true]
        );

        if (updateResult.rowCount === 0) {
            // If user doesn't exist for some reason, insert
            await pool.query(
                "INSERT INTO public.admins (userid, password, accesstopage, createdate, active) VALUES ($1, $2, $3, NOW(), $4)",
                ['Admin', hashedPassword, ['dashboard', 'orders', 'products', 'users', 'categories', 'brands', 'health-tips', 'subcategories', 'offers', 'faqs', 'contact', 'reviews', 'addresses', 'wishlist', 'cart', 'analytics'], true]
            );
            res.json({ success: true, message: "Admin user created successfully." });
        } else {
            res.json({ success: true, message: "Admin user updated successfully.", admin: updateResult.rows[0] });
        }

    } catch (error) {
        console.error("Setup Admin Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});


module.exports = router;
