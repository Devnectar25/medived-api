const express = require('express');
const router = express.Router();
const subcategoryController = require('../controllers/subcategoryController');

router.get('/', subcategoryController.getSubcategories);
router.get('/active', subcategoryController.getActiveSubcategories);
router.get('/:id', subcategoryController.getSubcategoryById);
router.post('/', subcategoryController.createSubcategory);
router.put('/:id', subcategoryController.updateSubcategory);
router.delete('/:id', subcategoryController.deleteSubcategory);
router.patch('/:id/activate', subcategoryController.setActiveSubcategory);
router.patch('/:id/deactivate', subcategoryController.setInactiveSubcategory);

module.exports = router;
