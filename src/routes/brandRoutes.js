const express = require('express');
const router = express.Router();
const brandController = require('../controllers/brandController');


// Image management routes
router.post('/upload-image', brandController.uploadMiddleware, brandController.uploadBrandImage);
router.delete('/delete-image', brandController.deleteBrandImage);

router.get('/', brandController.getBrands);
router.get('/active', brandController.getActiveBrands);
router.get('/:id', brandController.getBrandById); // Added get by ID
router.post('/', brandController.createBrand);
router.put('/:id', brandController.updateBrand);
router.delete('/:id', brandController.deleteBrand);
router.patch('/:id/activate', brandController.setActiveBrand);
router.patch('/:id/deactivate', brandController.setInactiveBrand);

module.exports = router;