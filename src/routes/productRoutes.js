const express = require('express');
const router = express.Router();

const productController = require('../controllers/productController');
const multer = require('multer');
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }
});

// POST /api/products/import-excel
router.post('/import-excel', upload.single('file'), productController.importExcel);

// POST /api/products/bulk
router.post('/bulk', productController.bulkCreateProducts);

// GET /api/products/import-history
router.get('/import-history', productController.getImportHistory);

// DELETE /api/products/import-history/:id
router.delete('/import-history/:id', productController.deleteImportHistory);

// GET /api/products
router.get('/', productController.getProducts);

// GET /api/products/featured
router.get('/featured', productController.getFeaturedProducts);

// GET /api/products/search
router.get('/search', productController.searchProducts);

// POST /api/products/smart-search
router.post('/smart-search', productController.smartSearch);

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
