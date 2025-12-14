const express = require('express');
const router = express.Router();

const productController = require('../controllers/productController');

// GET /api/products
router.get('/', productController.getProducts);

// GET /api/products/:id
router.get('/:id', productController.getProduct);

module.exports = router;
