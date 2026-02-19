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
        // Create admins table if not exists with correct schema
        // Based on authService.js fields: adminid, userid, password, accesstopage, createdate, active

        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.admins (
                adminid SERIAL PRIMARY KEY,
                userid VARCHAR(255) UNIQUE NOT NULL,
                password TEXT NOT NULL,
                accesstopage TEXT[], 
                createdate TIMESTAMP DEFAULT NOW(),
                active BOOLEAN DEFAULT TRUE
            );
        `);

        // Check if admin exist
        const check = await pool.query("SELECT * FROM public.admins WHERE userid = 'Admin'");

        if (check.rows.length === 0) {
            // Create default admin: Admin/Admin (hashed)
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('Admin', salt);

            // Assuming full access for now
            const allPages = ['dashboard', 'orders', 'products', 'users', 'categories', 'brands', 'health-tips', 'subcategories', 'offers', 'faqs', 'contact', 'reviews', 'addresses', 'wishlist', 'cart', 'analytics'];

            await pool.query(
                "INSERT INTO public.admins (userid, password, accesstopage, createdate, active) VALUES ($1, $2, $3, NOW(), $4)",
                ['Admin', hashedPassword, allPages, true]
            );

            res.json({ success: true, message: "Created admins table and inserted default Admin user." });
        } else {
            // Update existing Admin password to match hash just in case of mismatch
            // const salt = await bcrypt.genSalt(10);
            // const hashedPassword = await bcrypt.hash('Admin', salt);
            // await pool.query("UPDATE public.admins SET password = $1 WHERE userid = 'Admin'", [hashedPassword]);

            res.json({ success: true, message: "Admin table exists and Admin user already present." });
        }
    } catch (error) {
        console.error("Setup Admin Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
