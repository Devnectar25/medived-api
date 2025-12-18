const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');

router.post('/category-image', uploadController.uploadMiddleware, uploadController.uploadCategoryImage);

module.exports = router;
