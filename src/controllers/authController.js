const authService = require('../services/authService');

exports.register = async (req, res) => {
    try {
        const result = await authService.registerUser(req.body);
        res.status(201).json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await authService.loginUser(email, password);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(401).json({ success: false, message: error.message });
    }
};

exports.verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;

        // Validate required fields
        if (!email || !otp) {
            console.error('[verifyOtp] Missing required fields:', { email: !!email, otp: !!otp });
            return res.status(400).json({
                success: false,
                message: 'Email and OTP are required',
                details: { email: !email ? 'missing' : 'provided', otp: !otp ? 'missing' : 'provided' }
            });
        }

        console.log(`[verifyOtp] Attempting to verify OTP for email: ${email}`);
        const result = await authService.verifyOtp(email, otp);
        console.log(`[verifyOtp] Successfully verified OTP for email: ${email}`);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[verifyOtp] Error:', error.message);
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.adminLogin = async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log(`[adminLogin] Attempt for username: ${username}`);
        const result = await authService.loginAdmin(username, password);
        console.log(`[adminLogin] Success for username: ${username}`);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error(`[adminLogin] FAILED: ${error.message}`, error.stack);
        res.status(401).json({ success: false, message: error.message });
    }
};

