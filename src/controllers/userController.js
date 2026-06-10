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

exports.updateProfile = async (req, res) => {
    try {
        const { fullName, phone, avatar } = req.body;
        const username = req.user.id;

        if (!username) {
            return res.status(401).json({ success: false, message: 'User not identified' });
        }

        if (phone !== undefined && (!phone || !phone.trim())) {
            return res.status(400).json({ success: false, message: 'Mobile number is required' });
        }

        const result = await pool.query(`
            UPDATE public.users
            SET fullname = COALESCE($1, fullname),
                contactno = COALESCE($2, contactno),
                avatar_url = COALESCE($3, avatar_url)
            WHERE username = $4
            RETURNING username, emailid, fullname, contactno, avatar_url, member_since
        `, [fullName || null, phone || null, avatar || null, username]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const row = result.rows[0];
        const updatedUser = {
            id: row.username,
            email: row.emailid,
            fullName: row.fullname,
            phone: row.contactno,
            avatar: row.avatar_url,
            memberSince: row.member_since,
            twoFactorEnabled: true
        };

        res.json({ success: true, user: updatedUser });
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ success: false, message: 'Failed to update profile', error: error.message });
    }
};
