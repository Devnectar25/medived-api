const targetingService = require('../services/targetingService');

exports.getTopCustomers = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const customers = await targetingService.getTopCustomers(limit);
        res.status(200).json({ success: true, data: customers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        // Optional: pass couponId so the response includes each user's assignment status
        const couponId = req.query.couponId ? parseInt(req.query.couponId) : null;
        const users = await targetingService.getAllUsers(couponId);
        res.status(200).json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.assignCoupon = async (req, res) => {
    try {
        const { couponId, userIds } = req.body;

        if (!couponId || !userIds || !Array.isArray(userIds)) {
            return res.status(400).json({ success: false, message: "Invalid parameters. Require couponId and userIds array" });
        }

        const result = await targetingService.assignCouponToUsers(couponId, userIds);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getActiveUsers = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;

        const users = await targetingService.getActiveUsers(limit);

        res.status(200).json({
            success: true,
            data: users
        });

    } catch (error) {
        console.error("Error fetching active users:", error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch active users"
        });
    }
};
