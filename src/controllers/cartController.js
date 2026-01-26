const cartService = require('../services/cartService');

exports.getCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const cart = await cartService.getCart(userId);
        res.status(200).json({ success: true, data: cart });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.addToCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId, quantity } = req.body;
        if (!productId) {
            return res.status(400).json({ success: false, message: 'Product ID is required' });
        }
        const item = await cartService.addToCart(userId, productId, quantity || 1);
        res.status(200).json({ success: true, data: item });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateQuantity = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId, quantity } = req.body;
        if (!productId || quantity === undefined) {
            return res.status(400).json({ success: false, message: 'Product ID and quantity are required' });
        }
        const item = await cartService.updateQuantity(userId, productId, quantity);
        res.status(200).json({ success: true, data: item });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.removeFromCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId } = req.params;
        const item = await cartService.removeFromCart(userId, productId);
        res.status(200).json({ success: true, data: item });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.clearCart = async (req, res) => {
    try {
        const userId = req.user.id;
        await cartService.clearCart(userId);
        res.status(200).json({ success: true, message: 'Cart cleared' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.syncCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const { localItems } = req.body;
        await cartService.syncCart(userId, localItems);
        res.status(200).json({ success: true, message: 'Cart synced' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
