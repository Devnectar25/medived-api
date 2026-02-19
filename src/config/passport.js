
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const pool = require('./db');
const authService = require('../services/authService'); // We'll need to expose a method to handle social login logic here or call it directly

// Helper to handle social user creation/retrieval
const handleSocialLogin = async (profile, provider, done) => {
    try {
        console.log(`📡 [SocialAuth] Processing ${provider} login for:`, profile.displayName || profile.id);
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        const photoUrl = profile.photos && profile.photos[0] ? profile.photos[0].value : null;
        const socialId = profile.id;

        console.log(`📡 [SocialAuth] Email: ${email}, SocialId: ${socialId}`);

        let user;

        // 1. Try to find user by social ID
        let query = `SELECT * FROM public.users WHERE ${provider}_id = $1`;
        console.log(`📡 [SocialAuth] Querying by ${provider}_id...`);
        let result = await pool.query(query, [socialId]);

        if (result.rows.length > 0) {
            console.log(`✅ [SocialAuth] User found by social ID`);
            user = result.rows[0];
        } else {
            // 2. If not found by social ID, try to find by email
            if (email) {
                console.log(`📡 [SocialAuth] Not found by ID, querying by email: ${email}`);
                result = await pool.query("SELECT * FROM public.users WHERE emailid = $1", [email]);
                if (result.rows.length > 0) {
                    user = result.rows[0];
                    console.log(`✅ [SocialAuth] User found by email, linking social account...`);
                    await pool.query(`UPDATE public.users SET ${provider}_id = $1, avatar_url = COALESCE(avatar_url, $2) WHERE id = $3`, [socialId, photoUrl, user.id]);
                }
            }
        }

        if (!user) {
            console.log(`📡 [SocialAuth] User not found, creating new account...`);
            const username = email ? email.split('@')[0] : `user_${socialId}`;

            // Generate unique username
            let finalUsername = username;
            let checkUser = await pool.query("SELECT * FROM public.users WHERE username = $1", [finalUsername]);
            let counter = 1;
            while (checkUser.rows.length > 0) {
                finalUsername = `${username}${counter}`;
                checkUser = await pool.query("SELECT * FROM public.users WHERE username = $1", [finalUsername]);
                counter++;
            }

            console.log(`📡 [SocialAuth] Final username: ${finalUsername}`);

            const insertQuery = `
                INSERT INTO public.users (username, emailid, password, active, createdate, member_since, ${provider}_id, avatar_url)
                VALUES ($1, $2, $3, true, NOW(), NOW(), $4, $5)
                RETURNING *
            `;

            console.log(`📡 [SocialAuth] Executing insert query...`);
            const newUser = await pool.query(insertQuery, [finalUsername, email, 'social_login_placeholder', socialId, photoUrl]);
            user = newUser.rows[0];
            console.log(`✅ [SocialAuth] New user created:`, user.id);
        }

        return done(null, user);
    } catch (err) {
        console.error(`❌ [SocialAuth] Error in handleSocialLogin:`, err);
        return done(err, null);
    }
};

// Debug logging to check environment variables
console.log('🔍 Checking Google OAuth credentials:');
console.log('GOOGLE_CLIENT_ID exists:', !!process.env.GOOGLE_CLIENT_ID);
console.log('GOOGLE_CLIENT_SECRET exists:', !!process.env.GOOGLE_CLIENT_SECRET);
console.log('GOOGLE_CLIENT_ID value:', process.env.GOOGLE_CLIENT_ID ? `${process.env.GOOGLE_CLIENT_ID.substring(0, 20)}...` : 'MISSING');

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    console.log('✅ Initializing Google OAuth Strategy');
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/api/auth/google/callback"
        // State is handled manually in authRoutes.js
    },
        async function (accessToken, refreshToken, profile, done) {
            // console.log("Google Profile:", profile);
            return handleSocialLogin(profile, 'google', done);
        }
    ));
    console.log('✅ Google OAuth Strategy initialized successfully');
} else {
    console.warn('⚠️ Google OAuth Strategy NOT initialized - missing credentials');
    console.warn('Please check your .env file for GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
}

// Debug logging for Facebook OAuth
console.log('🔍 Checking Facebook OAuth credentials:');
console.log('FACEBOOK_APP_ID exists:', !!process.env.FACEBOOK_APP_ID);
console.log('FACEBOOK_APP_SECRET exists:', !!process.env.FACEBOOK_APP_SECRET);

if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    console.log('✅ Initializing Facebook OAuth Strategy');
    passport.use(new FacebookStrategy({
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: "/api/auth/facebook/callback",
        profileFields: ['id', 'displayName', 'photos', 'email'],
        enableProof: true
        // State is handled manually in authRoutes.js
    },
        async function (accessToken, refreshToken, profile, done) {
            console.log("Facebook Profile:", profile);
            return handleSocialLogin(profile, 'facebook', done);
        }
    ));
    console.log('✅ Facebook OAuth Strategy initialized successfully');
} else {
    console.warn('⚠️ Facebook OAuth Strategy NOT initialized - missing credentials');
    console.warn('Please check your .env file for FACEBOOK_APP_ID and FACEBOOK_APP_SECRET');
}

// Serialization needed if using session, but we might just generate JWT in controller
passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

module.exports = passport;
