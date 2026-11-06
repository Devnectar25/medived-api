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

        let cleanFullName = undefined;
        if (fullName !== undefined) {
            if (fullName && /\d/.test(fullName)) {
                return res.status(400).json({ success: false, message: 'User Name must not contain numeric characters' });
            }
            cleanFullName = fullName ? fullName.toString().replace(/[^a-zA-Z\s]/g, '').trim() : '';
        }

        let cleanPhone = undefined;
        if (phone !== undefined) {
            cleanPhone = phone ? phone.toString().trim().replace(/\D/g, '') : '';
            if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
                cleanPhone = cleanPhone.slice(2);
            }
            if (!cleanPhone || !/^[6-9]\d{9}$/.test(cleanPhone)) {
                return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number' });
            }
        }

        const result = await pool.query(`
            UPDATE public.users
            SET fullname = COALESCE($1, fullname),
                contactno = COALESCE($2, contactno),
                avatar_url = COALESCE($3, avatar_url)
            WHERE username = $4
            RETURNING username, emailid, fullname, contactno, avatar_url, member_since
        `, [cleanFullName !== undefined ? (cleanFullName || null) : null, cleanPhone || null, avatar || null, username]);

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

exports.getProfile = async (req, res) => {
    try {
        const username = req.user.id;
        if (!username) {
            return res.status(401).json({ success: false, message: 'User not identified' });
        }

        const result = await pool.query(`
            SELECT username, emailid, fullname, contactno, avatar_url, member_since 
            FROM public.users 
            WHERE username = $1
        `, [username]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const row = result.rows[0];
        const user = {
            id: row.username,
            email: row.emailid,
            fullName: row.fullname || row.username,
            phone: row.contactno,
            avatar: row.avatar_url,
            memberSince: row.member_since,
            twoFactorEnabled: true
        };

        res.json({ success: true, user });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch profile', error: error.message });
    }
};



exports.deleteAccount = async (req, res) => {
    try {
        const username = req.user.id;
        const { reason } = req.body || {};

        if (!username) {
            return res.status(401).json({ success: false, message: 'User not identified' });
        }

        console.log(`[UserController] Processing account deletion request for user: ${username}, reason: ${reason || 'Not specified'}`);

        // 1. Clear cart items
        await pool.query("DELETE FROM cart_items WHERE user_id = $1", [username]).catch(e => console.warn('[deleteAccount] Clear cart:', e.message));

        // 2. Clear wishlist
        await pool.query("DELETE FROM wishlist WHERE user_id = $1", [username]).catch(e => console.warn('[deleteAccount] Clear wishlist:', e.message));

        // 3. Clear saved user addresses
        await pool.query("DELETE FROM user_addresses WHERE user_id = $1", [username]).catch(e => console.warn('[deleteAccount] Clear addresses:', e.message));

        // 4. Anonymize and deactivate user account (preserves historical orders/invoices for tax and financial compliance)
        const result = await pool.query(`
            UPDATE public.users
            SET active = false,
                fullname = 'Closed Account',
                contactno = NULL,
                avatar_url = NULL,
                password = 'ACCOUNT_DEACTIVATED_' || SUBSTRING(MD5(RANDOM()::TEXT), 1, 16)
            WHERE username = $1
            RETURNING username
        `, [username]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({
            success: true,
            message: 'Your account and personal data have been removed and closed successfully.'
        });
    } catch (error) {
        console.error('[UserController] deleteAccount Error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete account', error: error.message });
    }
};
