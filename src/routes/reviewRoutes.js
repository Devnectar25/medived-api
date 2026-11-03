const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');

router.get('/stats/overall', reviewController.getOverallStats);
router.get('/', reviewController.getAllReviewsAdmin);
router.get('/:productId', reviewController.getProductReviews);
router.post('/', reviewController.addProductReview);
router.delete('/:id', reviewController.deleteReviewAdmin);

module.exports = router;
