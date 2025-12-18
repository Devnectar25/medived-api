const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');

router.get('/', categoryController.getCategories);
router.get('/active', categoryController.getActiveCategories);
router.post('/', categoryController.createCategory);
router.put('/:id', categoryController.updateCategory);
router.delete('/:id', categoryController.deleteCategory);
router.patch('/:id/activate', categoryController.setActiveCategory);
router.patch('/:id/deactivate', categoryController.setInactiveCategory);

module.exports = router;
