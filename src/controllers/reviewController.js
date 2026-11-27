const reviewService = require('../services/reviewService');

exports.getProductReviews = async (req, res) => {
    try {
        const { productId } = req.params;
        const [reviews, summary] = await Promise.all([
            reviewService.getReviewsByProduct(productId),
            reviewService.getReviewSummary(productId)
        ]);

        res.status(200).json({
            success: true,
            data: {
                reviews,
                summary
            }
        });
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getMyReviewedProducts = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'User not identified' });
        }

        const productIds = await reviewService.getReviewedProductIdsByUser(userId);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({
            success: true,
            data: productIds
        });
    } catch (error) {
        console.error('Error fetching user reviewed products:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.addProductReview = async (req, res) => {
    try {
        const { productId, rating, review } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Please log in to submit feedback' });
        }

        if (!productId) {
            return res.status(400).json({ success: false, message: 'Missing product ID' });
        }

        const parsedRating = Number(rating);
        const effectiveRating = Number.isFinite(parsedRating) && parsedRating >= 1 && parsedRating <= 5
            ? Math.round(parsedRating)
            : 5;
        const effectiveReview = (typeof review === 'string' ? review.trim() : '') || '';

        const newReview = await reviewService.createReview({
            productId,
            username: userId,
            rating: effectiveRating,
            review: effectiveReview
        });

        res.status(201).json({
            success: true,
            message: 'Review added successfully',
            data: newReview
        });
    } catch (error) {
        console.error('Error adding review:', error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
    }
};

exports.getAllReviewsAdmin = async (req, res) => {
    try {
        const { page, limit, search, rating, productId, sortBy, sortOrder } = req.query;
        const result = await reviewService.getAllReviews({
            page,
            limit,
            search,
            rating,
            productId,
            sortBy,
            sortOrder
        });

        const stats = await reviewService.getOverallReviewStats();

        res.status(200).json({
            success: true,
            data: result.data,
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
            stats
        });
    } catch (error) {
        console.error('Error fetching admin reviews:', error);
        res.status(500).json({ success: false, message: 'Server error fetching reviews' });
    }
};

exports.getOverallStats = async (req, res) => {
    try {
        const stats = await reviewService.getOverallReviewStats();
        res.status(200).json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error fetching overall review stats:', error);
        res.status(500).json({ success: false, message: 'Server error fetching stats' });
    }
};

exports.deleteReviewAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await reviewService.deleteReview(id);

        if (!result) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        res.status(200).json({
            success: true,
            message: 'Review deleted successfully',
            data: result
        });
    } catch (error) {
        console.error('Error deleting review:', error);
        res.status(500).json({ success: false, message: 'Server error deleting review' });
    }
};
