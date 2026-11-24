const express = require('express');
const router = express.Router();
const { cachePublic, invalidateOnWrite } = require('../middlewares/publicCache');

const LIST_TTL = 30 * 1000;

router.use(invalidateOnWrite);
const categoryController = require('../controllers/categoryController');

router.get('/', cachePublic(LIST_TTL), categoryController.getCategories);
router.get('/active', cachePublic(LIST_TTL), categoryController.getActiveCategories);
router.get('/:id', cachePublic(LIST_TTL), categoryController.getCategoryById);
router.post('/', categoryController.createCategory);
router.put('/:id', categoryController.updateCategory);
router.delete('/:id', categoryController.deleteCategory);
router.patch('/:id/activate', categoryController.setActiveCategory);
router.patch('/:id/deactivate', categoryController.setInactiveCategory);

module.exports = router;
