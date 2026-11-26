// Client for the Homved OTP API. Codes are generated, delivered by SMS and checked
// entirely by Homved; this backend never sees or stores the expected value.

const BASE_URL = (process.env.HOMVED_OTP_BASE_URL || 'https://uat.homved.com/api/otp').replace(/\/+$/, '');
const TIMEOUT_MS = 15000;

// Homved accepts only the purposes "registration" and "forgot_password" (others are rejected
// with "Invalid OTP purpose"), and checks them against its own user system, not this database:
//   "registration" is refused for numbers Homved already has ("...phone number already exists")
//   "forgot_password" is refused for numbers it does not have ("...phone number does not exist")
// So every flow starts with the purpose below and, on one of those two refusals, sends with the
// other one. The purpose actually used is kept with the session, because verify must match it.
const PURPOSES = {
    registration: 'registration',
    login: process.env.HOMVED_OTP_LOGIN_PURPOSE || 'registration',
    password_reset: process.env.HOMVED_OTP_RESET_PURPOSE || 'registration'
};

const otpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const normalizeMobile = (value) => {
    let digits = (value || '').toString().replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    return /^[6-9]\d{9}$/.test(digits) ? digits : null;
};

const maskMobile = (mobile) => `********${mobile.slice(-2)}`;

const OTHER_PURPOSE = { registration: 'forgot_password', forgot_password: 'registration' };
const WRONG_PURPOSE_REFUSAL = /phone number (already exists|does not exist)/i;

const purposeFor = (type) => {
    const purpose = PURPOSES[type];
    if (!purpose) throw otpError('Invalid verification session', 400);
    return purpose;
};

const post = async (action, payload) => {
    let response;
    let body;
    try {
        response = await fetch(`${BASE_URL}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        body = await response.json();
    } catch (err) {
        console.error(`[homvedOtp] ${action} failed (status ${response?.status ?? 'none'}): ${err.message}`);
        throw otpError('OTP service is currently unavailable. Please try again shortly.', 503);
    }

    if (response.status >= 500) {
        console.error(`[homvedOtp] ${action} returned ${response.status}: ${body?.message}`);
        throw otpError('OTP service is currently unavailable. Please try again shortly.', 503);
    }
    return { httpOk: response.ok, body: body || {} };
};

exports.normalizeMobile = normalizeMobile;
exports.maskMobile = maskMobile;

const send = async (mobileNo, purpose) => {
    const { httpOk, body } = await post('send', { mobileNo, purpose });
    const codeOk = body.code === undefined || (body.code >= 200 && body.code < 300);
    if (!httpOk || !codeOk) {
        console.warn(`[homvedOtp] send (${purpose}) rejected for ${maskMobile(mobileNo)}: ${body.message}`);
        const err = otpError(body.message || 'Could not send OTP. Please try again.', 400);
        err.wrongPurpose = WRONG_PURPOSE_REFUSAL.test(body.message || '');
        throw err;
    }
};

// Resolves with the purpose Homved accepted; throws if neither purpose was accepted.
exports.sendOtp = async (mobileNo, type) => {
    const purpose = purposeFor(type);
    try {
        await send(mobileNo, purpose);
        return purpose;
    } catch (err) {
        if (!err.wrongPurpose || !OTHER_PURPOSE[purpose]) throw err;
        await send(mobileNo, OTHER_PURPOSE[purpose]);
        return OTHER_PURPOSE[purpose];
    }
};

// Resolves only when Homved explicitly reports verified: true; throws otherwise.
// `purpose` is the one sendOtp returned; sessions saved before that was recorded fall back to the default.
exports.verifyOtp = async (mobileNo, type, otp, purpose) => {
    const { httpOk, body } = await post('verify', { mobileNo, purpose: purpose || purposeFor(type), otp });
    if (!httpOk || body.verified !== true) {
        console.warn(`[homvedOtp] verify rejected for ${maskMobile(mobileNo)}: ${body.message}`);
        throw otpError(body.message || 'Invalid verification code', 400);
    }
};
