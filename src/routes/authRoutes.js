const express = require('express');
const router = express.Router();
const passport = require('passport');
const authController = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');
const crypto = require('crypto');

// Google Auth with PKCE security
router.get('/google', (req, res, next) => {
    // Generate random state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state in session for validation on callback
    req.session = req.session || {};
    req.session.oauth_state = state;

    console.log('🔐 Generated OAuth state:', state.substring(0, 16) + '...');

    // Pass state to Google OAuth
    passport.authenticate('google', {
        scope: ['profile', 'email'],
        state: state
    })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
    // Validate state parameter to prevent CSRF
    const receivedState = req.query.state;
    const storedState = req.session?.oauth_state;

    console.log('🔐 Validating OAuth state...');
    console.log('Received state:', receivedState?.substring(0, 16) + '...');
    console.log('Stored state:', storedState?.substring(0, 16) + '...');

    if (!receivedState || !storedState || receivedState !== storedState) {
        console.error('❌ OAuth state validation failed - possible CSRF attack');
        return res.redirect(`${process.env.CLIENT_URL}/auth?error=state_mismatch`);
    }

    // Clear state from session
    delete req.session.oauth_state;

    console.log('✅ OAuth state validated successfully');

    passport.authenticate('google', {
        failureRedirect: `${process.env.CLIENT_URL}/auth?error=google_auth_failed`
    })(req, res, next);
}, authController.socialCallback);


// Facebook Auth with PKCE security
router.get('/facebook', (req, res, next) => {
    // Generate random state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state in session for validation on callback
    req.session = req.session || {};
    req.session.oauth_state_facebook = state;

    console.log('🔐 Generated Facebook OAuth state:', state.substring(0, 16) + '...');

    // Pass state to Facebook OAuth
    passport.authenticate('facebook', {
        scope: ['email'],
        state: state
    })(req, res, next);
});

router.get('/facebook/callback', (req, res, next) => {
    // Validate state parameter to prevent CSRF
    const receivedState = req.query.state;
    const storedState = req.session?.oauth_state_facebook;

    console.log('🔐 Validating Facebook OAuth state...');
    console.log('Received state:', receivedState?.substring(0, 16) + '...');
    console.log('Stored state:', storedState?.substring(0, 16) + '...');

    if (!receivedState || !storedState || receivedState !== storedState) {
        console.error('❌ Facebook OAuth state validation failed - possible CSRF attack');
        return res.redirect(`${process.env.CLIENT_URL}/auth?error=state_mismatch`);
    }

    // Clear state from session
    delete req.session.oauth_state_facebook;

    console.log('✅ Facebook OAuth state validated successfully');

    passport.authenticate('facebook', {
        failureRedirect: `${process.env.CLIENT_URL}/auth?error=facebook_auth_failed`
    })(req, res, next);
}, authController.socialCallback);

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/verify-otp', authController.verifyOtp);
router.post('/admin/login', authController.adminLogin);



// Debug: decode current token and return payload
router.get('/me', protect, (req, res) => {
    res.json({ success: true, user: req.user });
});

module.exports = router;
