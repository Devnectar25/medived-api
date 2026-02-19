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

app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: !!process.env.CORS_ORIGIN // only true when a specific origin is set
}));


app.use(express.json());

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

app.get('/', (req, res) => {
    res.send("HomeVed API is running....");
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err.stack);
    res.status(500).json({
        success: false,
        error: "Internal Server Error"
    });
});

module.exports = app;
