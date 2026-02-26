const couponService = require('../services/couponService');

exports.createCoupon = async (req, res) => {
    try {
        const coupon = await couponService.createCoupon(req.body);
        res.status(201).json({ success: true, data: coupon });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateCoupon = async (req, res) => {
    try {
        const result = await couponService.updateCoupon(req.params.id, req.body);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(error.message === 'Coupon not found' ? 404 : 400).json({ success: false, message: error.message });
    }
};

exports.getAllCoupons = async (req, res) => {
    try {
        const coupons = await couponService.getAllCoupons();
        res.status(200).json({ success: true, data: coupons });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.toggleCouponStatus = async (req, res) => {
    try {
        const coupon = await couponService.toggleCouponStatus(req.params.id);
        res.status(200).json({ success: true, data: coupon });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
};

exports.deleteCoupon = async (req, res) => {
    try {
        await couponService.deleteCoupon(req.params.id);
        res.status(200).json({ success: true, message: 'Coupon deleted' });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
};

exports.validateCoupon = async (req, res) => {
    try {
        const { code, orderTotal, cartItems } = req.body;

        if (!code) {
            return res.status(400).json({ success: false, message: 'Coupon code is required' });
        }
        if (orderTotal === undefined || orderTotal === null) {
            return res.status(400).json({ success: false, message: 'orderTotal is required' });
        }

        // req.user is guaranteed by the protect middleware on this route
        const userId = req.user.id;

        const result = await couponService.validateCoupon(
            code,
            parseFloat(orderTotal),
            Array.isArray(cartItems) ? cartItems : [],
            userId
        );
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getUserCoupons = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        console.log(`[getUserCoupons] Request by userId: ${userId}, role: ${userRole}`);
        const coupons = await couponService.getUserCoupons(userId);
        res.status(200).json({ success: true, data: coupons });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getCouponAssignments = async (req, res) => {
    try {
        const assignments = await couponService.getCouponAssignments(req.params.id);
        res.status(200).json({ success: true, data: assignments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.revokeAssignment = async (req, res) => {
    try {
        const { couponId, userId } = req.params;
        const result = await couponService.revokeAssignment(couponId, userId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
};

exports.getUsedUsers = async (req, res) => {
    try {
        const result = await couponService.getUsedUsers(req.params.id);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
