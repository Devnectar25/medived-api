const wishlistService = require('../services/wishlistService');

exports.addToWishlist = async (req, res) => {
    try {
        const { userId, productId } = req.body;
        if (!userId || !productId) {
            return res.status(400).json({ success: false, message: 'User ID and Product ID are required' });
        }
        const item = await wishlistService.addToWishlist(userId, productId);
        res.status(201).json({ success: true, data: item });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getWishlistByUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const wishlist = await wishlistService.getWishlistByUser(userId);
        res.json({ success: true, data: wishlist });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.removeFromWishlist = async (req, res) => {
    try {
        const { userId, productId } = req.params;
        const item = await wishlistService.removeFromWishlist(userId, productId);
        res.json({ success: true, data: item, message: 'Product removed from wishlist' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
