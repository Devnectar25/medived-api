const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key';
const JWT_EXPIRES_IN = '24h';

const generateToken = (id, role) => {
    return jwt.sign({ id: id.toString(), role }, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN
    });
};

// --- USER AUTH ---

exports.registerUser = async (data) => {
    const { email, password, fullName, phone } = data;

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Using email as username since it's the PK
    const username = email;

    const result = await pool.query(
        "INSERT INTO public.users (username, emailid, password, contactno, active, createdate) VALUES ($1, $2, $3, $4, true, NOW()) RETURNING username, emailid",
        [username, email, hashedPassword, phone]
    );


    const user = result.rows[0];
    const token = generateToken(user.username, 'user');

    return {
        user: {
            userid: user.username,
            email: user.emailid,
            fullName: fullName || user.username
        },
        token
    };
};

exports.loginUser = async (email, password) => {
    // Try both username and emailid just in case
    const result = await pool.query("SELECT * FROM public.users WHERE emailid = $1 OR username = $1", [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
        throw new Error("Invalid email or password");
    }

    const token = generateToken(user.username, 'user');
    delete user.password;

    return {
        user: {
            ...user,
            userid: user.username,
            email: user.emailid,
            fullName: user.username // Fallback if no full name column
        },
        token
    };
};

// --- ADMIN AUTH ---

exports.loginAdmin = async (username, password) => {
    const result = await pool.query("SELECT * FROM public.admins WHERE userid = $1", [username]);
    const adminRow = result.rows[0];

    if (!adminRow || !(await bcrypt.compare(password, adminRow.password))) {
        if (adminRow && adminRow.password === password) {
            // allow plain
        } else {
            throw new Error("Invalid username or password");
        }
    }

    const token = generateToken(adminRow.adminid, 'admin');

    // Map to frontend structure
    const admin = {
        id: adminRow.adminid.toString(),
        username: adminRow.userid,
        role: adminRow.userid === 'Admin' ? 'super_admin' : 'sub_admin',
        permissions: adminRow.accesstopage || [],
        createdate: adminRow.createdate
    };

    return { admin, token };
};
