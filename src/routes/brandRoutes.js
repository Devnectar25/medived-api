const express = require('express');
const router = express.Router();
const brandController = require('../controllers/brandController');

router.get('/', brandController.getBrands);
router.get('/active', brandController.getActiveBrands);
router.post('/', brandController.createBrand);
router.put('/:id', brandController.updateBrand);
router.delete('/:id', brandController.deleteBrand);
router.patch('/:id/activate', brandController.setActiveBrand);
router.patch('/:id/deactivate', brandController.setInactiveBrand);

module.exports = router;
