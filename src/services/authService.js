const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const homvedOtp = require('./homvedOtpService');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key';
const JWT_EXPIRES_IN = '24h';

const generateToken = (id, role) => {
    return jwt.sign({ id: id.toString(), role }, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN
    });
};

// Pending verification sessions (who is verifying and what for), cached in memory and
// persisted in the database. The OTP itself lives only with the Homved OTP API.
const otpStore = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000;

// Password reset sessions are keyed by mobile number, login/registration ones by email.
const resetKey = (mobile) => `password_reset:${mobile}`;

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
                '', // legacy NOT NULL column; the code is held by Homved and never stored here
                record.type,
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

// Numbers are stored in mixed formats and are not unique, so this can return several users.
const findUsersByMobile = async (mobile) => {
    const result = await pool.query(
        "SELECT * FROM public.users WHERE regexp_replace(contactno, '\\D', '', 'g') IN ($1::text, '91' || $1::text)",
        [mobile]
    );
    return result.rows;
};

exports.registerUser = async (data) => {
    const { email, password, fullName, phone } = data;
    if (!email) throw new Error("Email is required");
    if (fullName && /\d/.test(fullName)) {
        throw new Error("Full name must not contain numeric characters");
    }
    const cleanEmail = email.toString().trim().toLowerCase();

    const cleanPhone = homvedOtp.normalizeMobile(phone);
    if (!cleanPhone) {
        throw new Error("Please enter a valid 10-digit mobile number");
    }

    // Check if user already exists
    const existingUser = await pool.query("SELECT * FROM public.users WHERE LOWER(emailid) = $1 OR LOWER(username) = $1", [cleanEmail]);
    if (existingUser.rows.length > 0) {
        throw new Error("Email already registered");
    }

    // Mobile number is the login identifier, so new accounts must not reuse one
    if ((await findUsersByMobile(cleanPhone)).some((u) => u.active !== false)) {
        throw new Error("Mobile number already registered");
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await homvedOtp.sendOtp(cleanPhone, 'registration');

    // Store registration data in persistent storage
    await saveOtpRecord(cleanEmail, {
        expires: Date.now() + SESSION_TTL_MS,
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
        phone: homvedOtp.maskMobile(cleanPhone)
    };
};

exports.loginUser = async (mobileNo, password) => {
    const mobile = homvedOtp.normalizeMobile(mobileNo);
    if (!mobile) {
        const err = new Error("Please enter a valid 10-digit mobile number");
        err.statusCode = 400;
        throw err;
    }
    if (!password) throw new Error("Invalid mobile number or password");

    // Existing accounts can share a number; the password decides which one is logging in
    const matches = [];
    for (const candidate of await findUsersByMobile(mobile)) {
        if (candidate.password && await bcrypt.compare(password, candidate.password)) {
            matches.push(candidate);
        }
    }
    if (matches.length === 0) {
        throw new Error("Invalid mobile number or password");
    }

    const activeMatches = matches.filter((u) => u.active !== false);
    if (activeMatches.length === 0) {
        throw new Error("This account has been closed. Please contact support if you need assistance.");
    }
    if (activeMatches.length > 1) {
        const err = new Error("More than one account uses this mobile number and password. Please contact support.");
        err.statusCode = 409;
        throw err;
    }

    const user = activeMatches[0];
    // Key of the pending verification session, sent back by the client on verify/resend
    const cleanEmail = (user.emailid || user.username).trim().toLowerCase();

    await homvedOtp.sendOtp(mobile, 'login');

    await saveOtpRecord(cleanEmail, {
        expires: Date.now() + SESSION_TTL_MS,
        type: 'login',
        userData: {
            id: user.username,
            userid: user.username,
            email: user.emailid,
            fullName: user.fullname || user.username,
            phone: user.contactno,
            mobile,
            twoFactorEnabled: true
        }
    });

    return {
        requires2FA: true,
        userId: user.username,
        email: cleanEmail,
        phone: homvedOtp.maskMobile(mobile)
    };
};

// The number the OTP for this session was sent to.
const sessionMobile = (record) => {
    const mobile = homvedOtp.normalizeMobile(
        record.type === 'registration' ? record.registrationData?.phone : record.userData?.mobile
    );
    if (!mobile) throw new Error("Verification session is invalid. Please try again.");
    return mobile;
};

exports.verifyOtp = async (email, otp) => {
    if (!email || !otp) {
        throw new Error("Email and OTP are required");
    }
    const cleanEmail = email.toString().trim().toLowerCase();
    const cleanOtp = otp.toString().trim();

    console.log(`[verifyOtp Service] Checking OTP for email: ${cleanEmail}`);
    const record = await getOtpRecord(cleanEmail);

    if (!record || !['registration', 'login'].includes(record.type)) {
        console.error(`[verifyOtp Service] No OTP record found for email: ${cleanEmail}`);
        throw new Error("OTP not requested or already used. Please request a new one.");
    }

    // Check expiration
    if (Date.now() > record.expires) {
        console.error(`[verifyOtp Service] OTP expired for email: ${cleanEmail}`);
        await deleteOtpRecord(cleanEmail);
        throw new Error("OTP has expired. Please request a new one");
    }

    await homvedOtp.verifyOtp(sessionMobile(record), record.type, cleanOtp);

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
        const { mobile, ...userData } = record.userData;
        user = userData;
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
    if (!existingRecord || !['registration', 'login'].includes(existingRecord.type)) {
        throw new Error("No active verification session found. Please try registering or logging in again.");
    }
    if (Date.now() > existingRecord.expires) {
        await deleteOtpRecord(cleanEmail);
        throw new Error("Verification session has expired. Please try registering or logging in again.");
    }

    const mobile = sessionMobile(existingRecord);
    await homvedOtp.sendOtp(mobile, existingRecord.type);

    existingRecord.expires = Date.now() + SESSION_TTL_MS;
    await saveOtpRecord(cleanEmail, existingRecord);

    return {
        success: true,
        email: cleanEmail,
        phone: homvedOtp.maskMobile(mobile)
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

exports.requestPasswordReset = async (mobileNo) => {
    const mobile = homvedOtp.normalizeMobile(mobileNo);
    if (!mobile) {
        throw new Error("Please enter a valid 10-digit mobile number");
    }

    const users = (await findUsersByMobile(mobile)).filter((u) => u.active !== false);
    if (users.length === 0) {
        throw new Error("No account found with this mobile number");
    }
    // Older accounts can share a number; never guess whose password to reset
    if (users.length > 1) {
        const err = new Error("More than one account uses this mobile number. Please contact support to reset your password.");
        err.statusCode = 409;
        throw err;
    }
    const user = users[0];

    await homvedOtp.sendOtp(mobile, 'password_reset');

    await saveOtpRecord(resetKey(mobile), {
        expires: Date.now() + SESSION_TTL_MS,
        type: 'password_reset',
        userData: { username: user.username, mobile }
    });

    return {
        success: true,
        phone: homvedOtp.maskMobile(mobile)
    };
};

exports.resetPasswordWithOtp = async (mobileNo, otp, newPassword) => {
    if (!mobileNo || !otp || !newPassword) {
        throw new Error("Mobile number, verification code, and new password are required");
    }

    const mobile = homvedOtp.normalizeMobile(mobileNo);
    if (!mobile) {
        throw new Error("Please enter a valid 10-digit mobile number");
    }
    const cleanOtp = otp.toString().trim();

    // Checked before verification because a successful verify consumes the OTP
    if (newPassword.length < 8) {
        throw new Error("Password must be at least 8 characters");
    }

    const record = await getOtpRecord(resetKey(mobile));
    if (!record || record.type !== 'password_reset') {
        throw new Error("Password reset request not found or expired. Please request a new code.");
    }

    if (Date.now() > record.expires) {
        await deleteOtpRecord(resetKey(mobile));
        throw new Error("Verification code has expired. Please request a new one.");
    }

    await homvedOtp.verifyOtp(sessionMobile(record), 'password_reset', cleanOtp);

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update in database
    await pool.query(
        "UPDATE public.users SET password = $1 WHERE username = $2",
        [hashedPassword, record.userData.username]
    );

    // Invalidate OTP
    await deleteOtpRecord(resetKey(mobile));

    return {
        success: true,
        message: "Password reset successfully. You can now login with your new password."
    };
};



