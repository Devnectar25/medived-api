const pool = require('../config/db');
const bcrypt = require('bcryptjs');

exports.getSubAdmins = async () => {
    const result = await pool.query("SELECT * FROM public.admins WHERE userid != 'Admin'");
    return result.rows.map(row => ({
        id: row.adminid.toString(),
        username: row.userid,
        role: 'sub_admin',
        permissions: row.accesstopage || [],
        active: row.active,
        createdate: row.createdate
    }));
};

exports.createSubAdmin = async (data) => {
    const { username, password, permissions } = data;
    const existing = await pool.query("SELECT * FROM public.admins WHERE userid = $1", [username]);
    if (existing.rows.length > 0) throw new Error("Username already exists");

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const result = await pool.query(
        "INSERT INTO public.admins (userid, password, accesstopage, active, createdate) VALUES ($1, $2, $3, true, NOW()) RETURNING *",
        [username, hashedPassword, permissions]
    );

    const row = result.rows[0];
    return {
        id: row.adminid.toString(),
        username: row.userid,
        role: 'sub_admin',
        permissions: row.accesstopage || [],
        active: row.active,
        createdate: row.createdate
    };
};

exports.updateSubAdmin = async (id, data) => {
    const { username, password, permissions, active } = data;
    
    const existing = await pool.query("SELECT * FROM public.admins WHERE adminid = $1 AND userid != 'Admin'", [id]);
    if (existing.rows.length === 0) throw new Error("Sub-admin not found");

    let query = "UPDATE public.admins SET accesstopage = $1";
    const values = [permissions];
    let paramIndex = 2;

    if (username !== undefined) {
        query += `, userid = $${paramIndex}`;
        values.push(username);
        paramIndex++;
    }

    if (password) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        query += `, password = $${paramIndex}`;
        values.push(hashedPassword);
        paramIndex++;
    }

    if (active !== undefined) {
        query += `, active = $${paramIndex}`;
        values.push(active);
        paramIndex++;
    }

    query += ` WHERE adminid = $${paramIndex} RETURNING *`;
    values.push(id);

    const result = await pool.query(query, values);
    const row = result.rows[0];

    return {
        id: row.adminid.toString(),
        username: row.userid,
        role: 'sub_admin',
        permissions: row.accesstopage || [],
        active: row.active,
        createdate: row.createdate
    };
};

exports.deleteSubAdmin = async (id) => {
    const existing = await pool.query("SELECT * FROM public.admins WHERE adminid = $1 AND userid != 'Admin'", [id]);
    if (existing.rows.length === 0) throw new Error("Sub-admin not found");

    await pool.query("DELETE FROM public.admins WHERE adminid = $1", [id]);
};
