const express = require('express');
const router = express.Router();
const { cachePublic, invalidateOnWrite } = require('../middlewares/publicCache');

const LIST_TTL = 30 * 1000;

router.use(invalidateOnWrite);
const subcategoryController = require('../controllers/subcategoryController');

router.get('/', cachePublic(LIST_TTL), subcategoryController.getSubcategories);
router.get('/active', cachePublic(LIST_TTL), subcategoryController.getActiveSubcategories);
router.get('/:id', cachePublic(LIST_TTL), subcategoryController.getSubcategoryById);
router.post('/', subcategoryController.createSubcategory);
router.put('/:id', subcategoryController.updateSubcategory);
router.delete('/:id', subcategoryController.deleteSubcategory);
router.patch('/:id/activate', subcategoryController.setActiveSubcategory);
router.patch('/:id/deactivate', subcategoryController.setInactiveSubcategory);

module.exports = router;
