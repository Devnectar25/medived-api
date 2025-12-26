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

exports.adminLogin = async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await authService.loginAdmin(username, password);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(401).json({ success: false, message: error.message });
    }
};
