const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');

router.get('/:productId', reviewController.getProductReviews);
router.post('/', reviewController.addProductReview);

module.exports = router;
