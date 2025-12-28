const express = require('express');
const cors = require('cors');

const productRoutes = require('./routes/productRoutes');
const brandRoutes = require('./routes/brandRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const authRoutes = require('./routes/authRoutes');
const subcategoryRoutes = require('./routes/subcategoryRoutes');
const healthTipRoutes = require('./routes/healthTipRoutes');

const app = express();

app.use(cors());
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

app.get('/', (req, res) => {
    res.send("HomeVed API is running...");
});

module.exports = app;
