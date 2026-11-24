// Client for the Homved OTP API. Codes are generated, delivered by SMS and checked
// entirely by Homved; this backend never sees or stores the expected value.

const BASE_URL = (process.env.HOMVED_OTP_BASE_URL || 'https://uat.homved.com/api/otp').replace(/\/+$/, '');
const TIMEOUT_MS = 15000;

// Homved accepts only the purposes "registration" and "forgot_password" (others are rejected
// with "Invalid OTP purpose"). "forgot_password" is refused for numbers that are not users in
// Homved's own system ("User with this phone number does not exist"), and our customers live
// in this database, so login and password reset use "registration" too.
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

// Resolves only when Homved accepted the request; throws otherwise.
exports.sendOtp = async (mobileNo, type) => {
    const { httpOk, body } = await post('send', { mobileNo, purpose: purposeFor(type) });
    const codeOk = body.code === undefined || (body.code >= 200 && body.code < 300);
    if (!httpOk || !codeOk) {
        console.warn(`[homvedOtp] send rejected for ${maskMobile(mobileNo)}: ${body.message}`);
        throw otpError(body.message || 'Could not send OTP. Please try again.', 400);
    }
};

// Resolves only when Homved explicitly reports verified: true; throws otherwise.
exports.verifyOtp = async (mobileNo, type, otp) => {
    const { httpOk, body } = await post('verify', { mobileNo, purpose: purposeFor(type), otp });
    if (!httpOk || body.verified !== true) {
        console.warn(`[homvedOtp] verify rejected for ${maskMobile(mobileNo)}: ${body.message}`);
        throw otpError(body.message || 'Invalid verification code', 400);
    }
};
