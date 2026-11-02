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

// In-memory OTP cache + Database persistence
const otpStore = new Map();

const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const saveOtpRecord = async (cleanEmail, record) => {
    otpStore.set(cleanEmail, record);
    try {
        await pool.query(
            `INSERT INTO verification_otps (email, otp, type, expires_at, registration_data, user_data)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (email) DO UPDATE
             SET otp = EXCLUDED.otp,
                 type = EXCLUDED.type,
                 expires_at = EXCLUDED.expires_at,
                 registration_data = EXCLUDED.registration_data,
                 user_data = EXCLUDED.user_data,
                 created_at = NOW()`,
            [
                cleanEmail,
                record.otp,
                record.type || 'login',
                record.expires,
                record.registrationData ? JSON.stringify(record.registrationData) : null,
                record.userData ? JSON.stringify(record.userData) : null
            ]
        );
    } catch (err) {
        console.error('[authService] Failed to persist OTP to database (fallback in-memory):', err.message);
    }
};

const getOtpRecord = async (cleanEmail) => {
    let record = otpStore.get(cleanEmail);
    if (!record) {
        try {
            const dbRes = await pool.query(
                `SELECT email, otp, type, expires_at, registration_data, user_data 
                 FROM verification_otps 
                 WHERE LOWER(email) = $1`,
                [cleanEmail]
            );
            if (dbRes.rows.length > 0) {
                const row = dbRes.rows[0];
                record = {
                    otp: row.otp,
                    expires: parseInt(row.expires_at, 10),
                    type: row.type,
                    registrationData: row.registration_data,
                    userData: row.user_data
                };
                otpStore.set(cleanEmail, record);
            }
        } catch (err) {
            console.error('[authService] Failed to query OTP from database:', err.message);
        }
    }
    return record;
};

const deleteOtpRecord = async (cleanEmail) => {
    otpStore.delete(cleanEmail);
    try {
        await pool.query(`DELETE FROM verification_otps WHERE LOWER(email) = $1`, [cleanEmail]);
    } catch (err) {
        console.error('[authService] Failed to delete OTP from database:', err.message);
    }
};

// --- USER AUTH ---

exports.registerUser = async (data) => {
    const { email, password, fullName, phone } = data;
    if (!email) throw new Error("Email is required");
    const cleanEmail = email.toString().trim().toLowerCase();

    let cleanPhone = phone ? phone.toString().trim().replace(/\D/g, '') : '';
    if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
        cleanPhone = cleanPhone.slice(2);
    }
    if (!cleanPhone || !/^[6-9]\d{9}$/.test(cleanPhone)) {
        throw new Error("Please enter a valid 10-digit mobile number");
    }

    // Check if user already exists
    const existingUser = await pool.query("SELECT * FROM public.users WHERE LOWER(emailid) = $1 OR LOWER(username) = $1", [cleanEmail]);
    if (existingUser.rows.length > 0) {
        throw new Error("Email already registered");
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const otp = generateOTP();
    console.log(`[2FA] Registration OTP for ${cleanEmail}: ${otp}`);

    // Store registration data in persistent storage
    await saveOtpRecord(cleanEmail, {
        otp,
        expires: Date.now() + 10 * 60 * 1000,
        type: 'registration',
        registrationData: {
            email: cleanEmail,
            password: hashedPassword,
            fullName: (fullName || '').toString().trim(),
            phone: cleanPhone
        }
    });

    return {
        requiresVerification: true,
        email: cleanEmail,
        otp
    };
};

exports.loginUser = async (email, password) => {
    if (!email) throw new Error("Email is required");
    const cleanEmail = email.toString().trim().toLowerCase();

    // Try both username and emailid case-insensitively
    const result = await pool.query("SELECT * FROM public.users WHERE LOWER(emailid) = $1 OR LOWER(username) = $1", [cleanEmail]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
        throw new Error("Invalid email or password");
    }

    if (user.contactno || user.emailid) {
        const otp = generateOTP();
        console.log(`[2FA] OTP for ${user.emailid}: ${otp}`);

        // Store OTP with expiration (10 minutes)
        await saveOtpRecord(cleanEmail, {
            otp,
            expires: Date.now() + 10 * 60 * 1000,
            type: 'login',
            userData: {
                id: user.username,
                userid: user.username,
                email: user.emailid,
                fullName: user.fullname || user.username,
                phone: user.contactno,
                twoFactorEnabled: true
            }
        });

        return {
            requires2FA: true,
            userId: user.username,
            email: cleanEmail,
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
            fullName: user.fullname || user.username,
            phone: user.contactno,
            memberSince: user.member_since,
            twoFactorEnabled: true
        },
        token
    };
};

exports.verifyOtp = async (email, otp) => {
    if (!email || !otp) {
        throw new Error("Email and OTP are required");
    }
    const cleanEmail = email.toString().trim().toLowerCase();
    const cleanOtp = otp.toString().trim();

    console.log(`[verifyOtp Service] Checking OTP for email: ${cleanEmail}`);
    const record = await getOtpRecord(cleanEmail);

    if (!record) {
        console.error(`[verifyOtp Service] No OTP record found for email: ${cleanEmail}`);
        throw new Error("OTP not requested or already used. Please request a new one.");
    }

    // Check expiration
    if (Date.now() > record.expires) {
        console.error(`[verifyOtp Service] OTP expired for email: ${cleanEmail}`);
        await deleteOtpRecord(cleanEmail);
        throw new Error("OTP has expired. Please request a new one");
    }

    console.log(`[verifyOtp Service] Comparing OTPs - Provided: ${cleanOtp}, Stored: ${record.otp}`);
    if (record.otp !== cleanOtp) {
        console.error(`[verifyOtp Service] Invalid OTP for email: ${cleanEmail}`);
        throw new Error("Invalid verification code");
    }

    let user;
    let token;

    if (record.type === 'registration') {
        console.log(`[verifyOtp Service] Processing registration for email: ${cleanEmail}`);
        const { email: userEmail, password, fullName, phone } = record.registrationData;

        const username = userEmail;

        const result = await pool.query(
            "INSERT INTO public.users (username, emailid, password, contactno, active, createdate, member_since, fullname) VALUES ($1, $2, $3, $4, true, NOW(), NOW(), $5) RETURNING username, emailid, contactno, member_since, fullname",
            [username, userEmail, password, phone, fullName]
        );

        const newUser = result.rows[0];
        user = {
            id: newUser.username,
            userid: newUser.username,
            email: newUser.emailid,
            fullName: newUser.fullname || fullName || newUser.username,
            phone: newUser.contactno || phone,
            memberSince: newUser.member_since,
            twoFactorEnabled: true
        };
        token = generateToken(newUser.username, 'user');
    } else {
        console.log(`[verifyOtp Service] Processing login verification for email: ${cleanEmail}`);
        // Login verification
        user = record.userData;
        const loginId = user.id || user.userid;
        const loginResult = await pool.query("SELECT member_since, fullname, avatar_url, contactno FROM public.users WHERE username = $1", [loginId]);
        user.memberSince = loginResult.rows[0]?.member_since;
        user.fullName = loginResult.rows[0]?.fullname || user.fullName || loginId;
        user.avatar = loginResult.rows[0]?.avatar_url;
        user.phone = loginResult.rows[0]?.contactno || user.phone;
        token = generateToken(loginId, 'user');
    }

    // Clear OTP after success
    await deleteOtpRecord(cleanEmail);
    console.log(`[verifyOtp Service] Successfully verified OTP for email: ${cleanEmail}`);

    return {
        user,
        token
    };
};

exports.resendOtp = async (email) => {
    if (!email) throw new Error("Email is required");
    const cleanEmail = email.toString().trim().toLowerCase();
    console.log(`[resendOtp Service] Resending OTP for email: ${cleanEmail}`);
    
    // Check if there is an existing record to resend for
    const existingRecord = await getOtpRecord(cleanEmail);
    
    const otp = generateOTP();
    console.log(`[resendOtp Service] New OTP for ${cleanEmail}: ${otp}`);

    if (existingRecord) {
        // Update existing record with new OTP and refreshed expiry (10 minutes)
        existingRecord.otp = otp;
        existingRecord.expires = Date.now() + 10 * 60 * 1000;
        await saveOtpRecord(cleanEmail, existingRecord);
    } else {
        throw new Error("No active verification session found. Please try registering or logging in again.");
    }

    return {
        success: true,
        email: cleanEmail,
        otp
    };
};

// --- ADMIN AUTH ---

exports.loginAdmin = async (username, password, ipAddress) => {
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
            if (adminRow) {
                await pool.query("INSERT INTO audit_logs (admin_id, username, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)", [adminRow.adminid, username, 'FAILED_LOGIN', 'Invalid password', ipAddress]);
            } else {
                await pool.query("INSERT INTO audit_logs (admin_id, username, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)", [null, username, 'FAILED_LOGIN', 'User not found', ipAddress]);
            }
            throw new Error("Invalid username or password");
        }
    }

    if (adminRow.userid !== 'Admin' && adminRow.active === false) {
        await pool.query("INSERT INTO audit_logs (admin_id, username, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)", [adminRow.adminid, username, 'FAILED_LOGIN', 'Account deactivated', ipAddress]);
        throw new Error("Your account has been deactivated. Please contact Super Admin.");
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
        
        await pool.query("INSERT INTO audit_logs (admin_id, username, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)", [adminRow.adminid, username, 'LOGIN_SUCCESS', 'User logged in', ipAddress]);
        
        return { admin, token };
    } catch (e) {
        console.error(`[authService] Token generation failed: ${e.message}`, e.stack);
        throw new Error(`Token generation failed: ${e.message}`);
    }
};

exports.requestPasswordReset = async (email) => {
    if (!email) {
        throw new Error("Email is required");
    }
    const cleanEmail = email.trim().toLowerCase();

    // Check if user exists in public.users
    const result = await pool.query(
        "SELECT username, emailid FROM public.users WHERE LOWER(emailid) = $1 OR LOWER(username) = $1",
        [cleanEmail]
    );

    if (result.rows.length === 0) {
        throw new Error("No account found with this email address");
    }

    const user = result.rows[0];
    const otp = generateOTP();
    console.log(`[Password Reset OTP] for ${user.emailid}: ${otp}`);

    otpStore.set(user.emailid.toLowerCase(), {
        otp,
        expires: Date.now() + 10 * 60 * 1000, // 10 minutes
        type: 'password_reset',
        username: user.username,
        email: user.emailid
    });

    return {
        success: true,
        email: user.emailid,
        otp
    };
};

exports.resetPasswordWithOtp = async (email, otp, newPassword) => {
    if (!email || !otp || !newPassword) {
        throw new Error("Email, verification code, and new password are required");
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();

    const record = otpStore.get(cleanEmail);
    if (!record || record.type !== 'password_reset') {
        throw new Error("Password reset request not found or expired. Please request a new code.");
    }

    if (Date.now() > record.expires) {
        otpStore.delete(cleanEmail);
        throw new Error("Verification code has expired. Please request a new one.");
    }

    if (record.otp !== cleanOtp) {
        throw new Error("Invalid verification code");
    }

    if (newPassword.length < 8) {
        throw new Error("Password must be at least 8 characters");
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update in database
    await pool.query(
        "UPDATE public.users SET password = $1 WHERE username = $2 OR LOWER(emailid) = $3",
        [hashedPassword, record.username, cleanEmail]
    );

    // Invalidate OTP
    otpStore.delete(cleanEmail);

    return {
        success: true,
        message: "Password reset successfully. You can now login with your new password."
    };
};



