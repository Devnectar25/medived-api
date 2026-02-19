const express = require('express');
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

// Debug: Raw echo route to test request body stream before parsing
app.post('/api/echo', (req, res) => {
    console.log("Echo route hit");
    req.pipe(res);
});

console.log("Setting up body parser...");
app.use((req, res, next) => {
    console.log(`[Middleware] Processing ${req.method} ${req.url}`);

    // Wrap express.json in try-catch block for logging
    try {
        express.json()(req, res, (err) => {
            if (err) {
                console.error("JSON Parse Error inside middleware:", err);
                return next(err);
            }
            console.log("JSON Body Parsed successfully");
            next();
        });
    } catch (e) {
        console.error("CRITICAL: express.json() crashed synchronously:", e);
        next(e);
    }
});


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
app.use('/api/debug', require('./routes/debugRoutes')); // Temporary debug route


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

