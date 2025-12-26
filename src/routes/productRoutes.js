const express = require('express');
const router = express.Router();

const productController = require('../controllers/productController');

// GET /api/products
router.get('/', productController.getProducts);

// GET /api/products/:id
router.get('/:id', productController.getProduct);

// GET /api/products/:id/related
router.get('/:id/related', productController.getRelatedProducts);

// POST /api/products
router.post('/', productController.createProduct);

// PUT /api/products/:id
router.put('/:id', productController.updateProduct);

// DELETE /api/products/:id
router.delete('/:id', productController.deleteProduct);

// PATCH /api/products/:id/activate
router.patch('/:id/activate', productController.setActiveProduct);

// PATCH /api/products/:id/deactivate
router.patch('/:id/deactivate', productController.setInactiveProduct);

// PATCH /api/products/:id/toggle-active
router.patch('/:id/toggle-active', productController.toggleProductStatus);

module.exports = router;
