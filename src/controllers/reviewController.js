const reviewService = require('../services/reviewService');

exports.getProductReviews = async (req, res) => {
    try {
        const { productId } = req.params;
        const reviews = await reviewService.getReviewsByProduct(productId);
        const summary = await reviewService.getReviewSummary(productId);

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

exports.addProductReview = async (req, res) => {
    try {
        const { productId, username, rating, review } = req.body;

        if (!productId || !rating || !review) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const newReview = await reviewService.createReview({
            productId,
            username: username || 'Guest', // Fallback
            rating,
            review
        });

        res.status(201).json({
            success: true,
            message: 'Review added successfully',
            data: newReview
        });
    } catch (error) {
        console.error('Error adding review:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
