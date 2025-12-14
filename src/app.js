const express = require('express');
const cors = require('cors');

const productRoutes = require('./routes/productRoutes');
const brandRoutes = require('./routes/brandRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// ⭐ IMPORTANT — Attach API route
app.use('/api/products', productRoutes);
app.use('/api/brands', brandRoutes);

app.get('/', (req, res) => {
    res.send("HomeVed API is running...");
});

module.exports = app;
