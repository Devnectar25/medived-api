const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const pool = require('./db'); // your pg pool

// Helper: Find or create user on social login
const handleSocialLogin = async (profile, provider, done) => {
    try {
        console.log(`📡 [SocialAuth] Processing ${provider} login for:`, profile.displayName || profile.id);
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        const photoUrl = profile.photos && profile.photos[0] ? profile.photos[0].value : null;
        const socialId = profile.id;

        let user;

        // 1. Try to find user by social ID
        let result = await pool.query(`SELECT * FROM public.users WHERE ${provider}_id = $1`, [socialId]);

        if (result.rows.length > 0) {
            user = result.rows[0];
        } else {
            // 2. Try to find by email and link social account
            if (email) {
                result = await pool.query("SELECT * FROM public.users WHERE emailid = $1", [email]);
                if (result.rows.length > 0) {
                    user = result.rows[0];
                    await pool.query(`UPDATE public.users SET ${provider}_id = $1, avatar_url = COALESCE(avatar_url, $2) WHERE id = $3`, [socialId, photoUrl, user.id]);
                }
            }
        }

        if (!user) {
            // 3. Create new user
            const username = email ? email.split('@')[0] : `user_${socialId}`;
            let finalUsername = username;

            let checkUser = await pool.query("SELECT * FROM public.users WHERE username = $1", [finalUsername]);
            let counter = 1;
            while (checkUser.rows.length > 0) {
                finalUsername = `${username}${counter}`;
                checkUser = await pool.query("SELECT * FROM public.users WHERE username = $1", [finalUsername]);
                counter++;
            }

            const newUser = await pool.query(
                `INSERT INTO public.users (username, emailid, password, active, createdate, member_since, ${provider}_id, avatar_url)
                 VALUES ($1, $2, $3, true, NOW(), NOW(), $4, $5) RETURNING *`,
                [finalUsername, email, 'social_login_placeholder', socialId, photoUrl]
            );
            user = newUser.rows[0];
        }

        return done(null, user);
    } catch (err) {
        console.error(`❌ [SocialAuth] Error:`, err);
        return done(err, null);
    }
};

// Google Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/api/auth/google/callback"
    }, async (accessToken, refreshToken, profile, done) => {
        return handleSocialLogin(profile, 'google', done);
    }));
}

// Facebook Strategy
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    passport.use(new FacebookStrategy({
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: "/api/auth/facebook/callback",
        profileFields: ['id', 'displayName', 'photos', 'email'],
        enableProof: true
    }, async (accessToken, refreshToken, profile, done) => {
        return handleSocialLogin(profile, 'facebook', done);
    }));
}

passport.serializeUser((user, done) => { done(null, user); });
passport.deserializeUser((user, done) => { done(null, user); });

module.exports = passport;
