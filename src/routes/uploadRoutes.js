const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');

router.post('/upload-image', uploadController.uploadMiddleware, uploadController.uploadImage);
router.delete('/delete-image', uploadController.deleteImage);

module.exports = router;
