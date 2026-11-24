const express = require('express');
const router = express.Router();
const { cachePublic, invalidateOnWrite } = require('../middlewares/publicCache');

const LIST_TTL = 30 * 1000;

router.use(invalidateOnWrite);
const brandController = require('../controllers/brandController');


// Image management routes
router.post('/upload-image', brandController.uploadMiddleware, brandController.uploadBrandImage);
router.delete('/delete-image', brandController.deleteBrandImage);

router.get('/', cachePublic(LIST_TTL), brandController.getBrands);
router.get('/active', cachePublic(LIST_TTL), brandController.getActiveBrands);
router.get('/:id', cachePublic(LIST_TTL), brandController.getBrandById); // Added get by ID
router.post('/', brandController.createBrand);
router.put('/:id', brandController.updateBrand);
router.delete('/:id', brandController.deleteBrand);
router.patch('/:id/activate', brandController.setActiveBrand);
router.patch('/:id/deactivate', brandController.setInactiveBrand);

module.exports = router;