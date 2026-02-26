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

// In-memory OTP storage (for demo/simplicity)
const otpStore = new Map();

const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// --- USER AUTH ---

exports.registerUser = async (data) => {
    const { email, password, fullName, phone } = data;

    // Check if user already exists
    const existingUser = await pool.query("SELECT * FROM public.users WHERE emailid = $1 OR username = $1", [email]);
    if (existingUser.rows.length > 0) {
        throw new Error("Email already registered");
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const otp = generateOTP();
    console.log(`[2FA] Registration OTP for ${email}: ${otp}`);

    // Store registration data in otpStore
    otpStore.set(email, {
        otp,
        expires: Date.now() + 10 * 60 * 1000,
        type: 'registration',
        registrationData: {
            email,
            password: hashedPassword,
            fullName,
            phone
        }
    });

    return {
        requiresVerification: true,
        email,
        otp
    };
};

exports.loginUser = async (email, password) => {
    // Try both username and emailid just in case
    const result = await pool.query("SELECT * FROM public.users WHERE emailid = $1 OR username = $1", [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
        throw new Error("Invalid email or password");
    }

    if (user.contactno || user.emailid) {
        const otp = generateOTP();
        console.log(`[2FA] OTP for ${user.emailid}: ${otp}`);

        // Store OTP with expiration (5 minutes)
        otpStore.set(user.emailid, {
            otp,
            expires: Date.now() + 5 * 60 * 1000,
            userData: {
                id: user.username,
                userid: user.username,
                email: user.emailid,
                fullName: user.username,
                twoFactorEnabled: true
            }
        });

        return {
            requires2FA: true,
            userId: user.username,
            email: user.emailid,
            otp: otp // Sending OTP to frontend for EmailJS integration
        };
    }

    const token = generateToken(user.username, 'user');
    delete user.password;

    return {
        user: {
            ...user,
            id: user.username,
            userid: user.username,
            email: user.emailid,
            fullName: user.username,
            memberSince: user.member_since,
            twoFactorEnabled: true
        },
        token
    };
};

exports.verifyOtp = async (email, otp) => {
    console.log(`[verifyOtp Service] Checking OTP for email: ${email}`);
    const record = otpStore.get(email);

    if (!record) {
        console.error(`[verifyOtp Service] No OTP record found for email: ${email}`);
        throw new Error("OTP not requested or already used");
    }

    // Check expiration
    if (Date.now() > record.expires) {
        console.error(`[verifyOtp Service] OTP expired for email: ${email}`);
        otpStore.delete(email);
        throw new Error("OTP has expired. Please request a new one");
    }

    console.log(`[verifyOtp Service] Comparing OTPs - Provided: ${otp}, Stored: ${record.otp}`);
    if (record.otp !== otp) {
        console.error(`[verifyOtp Service] Invalid OTP for email: ${email}`);
        throw new Error("Invalid verification code");
    }

    let user;
    let token;

    if (record.type === 'registration') {
        console.log(`[verifyOtp Service] Processing registration for email: ${email}`);
        const { email: userEmail, password, fullName, phone } = record.registrationData;

        const username = userEmail;

        const result = await pool.query(
            "INSERT INTO public.users (username, emailid, password, contactno, active, createdate, member_since) VALUES ($1, $2, $3, $4, true, NOW(), NOW()) RETURNING username, emailid, member_since",
            [username, userEmail, password, phone]
        );

        const newUser = result.rows[0];
        user = {
            id: newUser.username,
            userid: newUser.username,
            email: newUser.emailid,
            fullName: fullName || newUser.username,
            memberSince: newUser.member_since,
            twoFactorEnabled: true
        };
        token = generateToken(newUser.username, 'user');
    } else {
        console.log(`[verifyOtp Service] Processing login verification for email: ${email}`);
        // Login verification
        user = record.userData;
        // Include memberSince for login as well
        const loginId = user.id || user.userid;
        const loginResult = await pool.query("SELECT member_since FROM public.users WHERE username = $1", [loginId]);
        user.memberSince = loginResult.rows[0]?.member_since;
        token = generateToken(loginId, 'user');
    }

    // Clear OTP after success
    otpStore.delete(email);
    console.log(`[verifyOtp Service] Successfully verified OTP for email: ${email}`);

    return {
        user,
        token
    };
};

// --- ADMIN AUTH ---

exports.loginAdmin = async (username, password) => {
    console.log(`[authService] loginAdmin called for: ${username}`);

    // 1. Query DB
    const result = await pool.query("SELECT * FROM public.admins WHERE userid = $1", [username]);
    const adminRow = result.rows[0];

    console.log(`[authService] DB lookup result: ${result.rowCount > 0 ? 'found' : 'not found'}`);

    if (!adminRow || !(await bcrypt.compare(password, adminRow.password))) {
        console.log(`[authService] Invalid credentials check`);
        if (adminRow && adminRow.password === password) {
            console.log(`[authService] Plain password matched (fallback)`);
        } else {
            console.log(`[authService] Credentials rejected`);
            throw new Error("Invalid username or password");
        }
    }

    console.log(`[authService] Credentials valid. Generating token...`);

    try {
        const token = generateToken(adminRow.adminid, 'admin');
        console.log(`[authService] Token generated.`);

        // Map to frontend structure
        const admin = {
            id: adminRow.adminid.toString(),
            username: adminRow.userid,
            role: adminRow.userid === 'Admin' ? 'super_admin' : 'sub_admin',
            permissions: adminRow.accesstopage || [], // Ensure array
            createdate: adminRow.createdate
        };

        console.log(`[authService] Admin object prepared: ${JSON.stringify(admin)}`);
        return { admin, token };
    } catch (e) {
        console.error(`[authService] Token generation failed: ${e.message}`, e.stack);
        throw new Error(`Token generation failed: ${e.message}`);
    }
};


