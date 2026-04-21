const pool = require('../config/db');

exports.getUsers = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT username, emailid, contactno, active, createdate 
            FROM public.users
            ORDER BY createdate DESC
        `);
        
        const mappedUsers = result.rows.map(row => ({
            id: row.username,
            name: row.username, // the id is username which often is email or name
            email: row.emailid,
            phone: row.contactno,
            active: row.active,
            createdAt: row.createdate
        }));

        res.json({ success: true, count: mappedUsers.length, data: mappedUsers });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch users', error: error.message });
    }
};
