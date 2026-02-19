const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/verify-otp', authController.verifyOtp);
router.post('/admin/login', authController.adminLogin);



// Debug: decode current token and return payload
router.get('/me', protect, (req, res) => {
    res.json({ success: true, user: req.user });
});

module.exports = router;
