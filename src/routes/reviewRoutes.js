const express = require('express');
const router = express.Router();
const { cachePublic, invalidateOnWrite } = require('../middlewares/publicCache');
const { protect } = require('../middlewares/authMiddleware');

const ITEM_TTL = 10 * 1000;

router.use(invalidateOnWrite);
const reviewController = require('../controllers/reviewController');

router.get('/stats/overall', reviewController.getOverallStats);
router.get('/my', protect, reviewController.getMyReviewedProducts);
router.get('/', reviewController.getAllReviewsAdmin);
router.get('/:productId', cachePublic(ITEM_TTL), reviewController.getProductReviews);
router.post('/', protect, reviewController.addProductReview);
router.delete('/:id', reviewController.deleteReviewAdmin);

module.exports = router;
