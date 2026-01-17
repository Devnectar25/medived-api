const express = require('express');
const router = express.Router();
const addressController = require('../controllers/addressController');

router.get('/user/:userId', addressController.getUserAddresses);
router.post('/', addressController.createAddress);
router.put('/:id', addressController.updateAddress);
router.delete('/:id', addressController.deleteAddress);

module.exports = router;
