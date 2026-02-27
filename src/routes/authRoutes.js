const express = require('express');
const router = express.Router();
const passport = require('passport');
const crypto = require('crypto');
const authController = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');


router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/verify-otp', authController.verifyOtp);
router.post('/admin/login', authController.adminLogin);



// --- GOOGLE OAUTH ---
router.get('/google', (req, res, next) => {
    const state = crypto.randomBytes(32).toString('hex');
    req.session = req.session || {};
    req.session.oauth_state = state;
    // Capture redirect URL if provided
    if (req.query.redirect) {
        req.session.returnTo = req.query.redirect;
    }
    req.session.save((err) => {
        if (err) return next(err);
        passport.authenticate('google', { scope: ['profile', 'email'], state })(req, res, next);
    });
});

router.get('/google/callback', (req, res, next) => {
    const receivedState = req.query.state;
    const storedState = req.session?.oauth_state;

    if (!receivedState || !storedState || receivedState !== storedState) {
        return res.redirect(`${process.env.CLIENT_URL}/auth?error=state_mismatch`);
    }

    delete req.session.oauth_state;

    passport.authenticate('google', {
        failureRedirect: `${process.env.CLIENT_URL}/auth?error=google_auth_failed`
    })(req, res, next);
}, authController.socialCallback);

// --- FACEBOOK OAUTH ---
router.get('/facebook', (req, res, next) => {
    const state = crypto.randomBytes(32).toString('hex');
    req.session = req.session || {};
    req.session.oauth_state_facebook = state;
    // Capture redirect URL if provided
    if (req.query.redirect) {
        req.session.returnTo = req.query.redirect;
    }
    req.session.save((err) => {
        if (err) return next(err);
        passport.authenticate('facebook', { scope: ['email'], state })(req, res, next);
    });
});

router.get('/facebook/callback', (req, res, next) => {
    const receivedState = req.query.state;
    const storedState = req.session?.oauth_state_facebook;

    if (!receivedState || !storedState || receivedState !== storedState) {
        return res.redirect(`${process.env.CLIENT_URL}/auth?error=state_mismatch`);
    }

    delete req.session.oauth_state_facebook;

    passport.authenticate('facebook', {
        failureRedirect: `${process.env.CLIENT_URL}/auth?error=facebook_auth_failed`
    })(req, res, next);
}, authController.socialCallback);

// Debug: decode current token and return payload
router.get('/me', protect, (req, res) => {
    res.json({ success: true, user: req.user });
});


module.exports = router;
