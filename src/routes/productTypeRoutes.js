
const express = require('express');
const router = express.Router();
const productTypeController = require('../controllers/productTypeController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/', productTypeController.getAllProductTypes);
router.post('/', authMiddleware, productTypeController.createProductType);
router.put('/:id', authMiddleware, productTypeController.updateProductType);
router.delete('/:id', authMiddleware, productTypeController.deleteProductType);

module.exports = router;
