const express = require('express');
const session = require('express-session');
const passport = require('./config/passport'); // Social login configuration

const cors = require('cors');

const productRoutes = require('./routes/productRoutes');
const brandRoutes = require('./routes/brandRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const authRoutes = require('./routes/authRoutes');
const subcategoryRoutes = require('./routes/subcategoryRoutes');
const healthTipRoutes = require('./routes/healthTipRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const adminAnalyticsRoutes = require("./routes/adminAnalyticsRoutes");

const app = express();
app.set('trust proxy', 1);

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Manual CORS middleware — cors package is unreliable on Vercel serverless
// for Authorization headers. This is explicit and guaranteed to work.
app.use((req, res, next) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');

    // Handle preflight OPTIONS request immediately
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

// Manual JSON body parser to bypass express.json() crash on Vercel
app.use((req, res, next) => {
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
        return next();
    }

    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
        return next();
    }

    // Skip manual parser for image uploads as they are handled by multer
    if (req.url.includes('/upload-image')) {
        return next();
    }

    let data = '';
    const MAX_SIZE = 1 * 1024 * 1024; // 1MB limit

    req.on('data', chunk => {
        data += chunk;
        if (data.length > MAX_SIZE) {
            req.destroy(); // Terminate request if too large
        }
    });

    req.on('end', () => {
        try {
            if (data && data.trim()) {
                req.body = JSON.parse(data);
            } else {
                req.body = {};
            }
            next();
        } catch (e) {
            console.error("Manual JSON Parse Error:", e);
            res.status(400).json({ success: false, error: "Invalid JSON body" });
        }
    });

    req.on('error', (err) => {
        console.error("Request stream error:", err);
        next(err);
    });
});

// Session middleware (MUST be before passport)
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());



// ⭐ IMPORTANT — Attach API route
app.use('/api/products', productRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/subcategories', subcategoryRoutes);
app.use('/api/health-tips', healthTipRoutes);
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/addresses', require('./routes/addressRoutes'));
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/cart', require('./routes/cartRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use("/api/admin/analytics", adminAnalyticsRoutes);
app.use('/api/contact', require('./routes/contactRoutes'));
app.use('/api/faqs', require('./routes/faqRoutes'));
app.use('/api/analytics', require('./routes/publicAnalyticsRoutes'));
// app.use('/api/debug', require('./routes/debugRoutes')); // Temporary debug route (Disabled for prod)
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/chatbot', require('./routes/chatbotRoutes'));


app.get('/', (req, res) => {
    res.send("HomeVed API is running....");
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err.stack);
    res.status(500).json({
        success: false,
        error: "Internal Server Error",
        debug_message: err.message,
        debug_stack: err.stack // Force show stack trace for debugging
    });
});


module.exports = app;

