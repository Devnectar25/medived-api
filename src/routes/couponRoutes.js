const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Admin Routes - Manage Coupons
// Matches /api/admin/coupons if mounted at /api
router.post('/admin/coupons', protect, authorize('super_admin', 'admin', 'subadmin'), couponController.createCoupon);
router.get('/admin/coupons', protect, authorize('super_admin', 'admin', 'subadmin'), couponController.getAllCoupons);
router.put('/admin/coupons/:id', protect, authorize('super_admin', 'admin', 'subadmin'), couponController.updateCoupon);
router.patch('/admin/coupons/:id/toggle-status', protect, authorize('super_admin', 'admin', 'subadmin'), couponController.toggleCouponStatus);
router.delete('/admin/coupons/:id', protect, authorize('super_admin', 'admin', 'subadmin'), couponController.deleteCoupon);

// Public/User Routes - Use Coupons
// Matches /api/coupons/validate if mounted at /api
router.post('/coupons/validate', protect, couponController.validateCoupon);

// GET /api/user/coupons — returns active global + personally assigned coupons for this user
router.get('/user/coupons', protect, couponController.getUserCoupons);

// Admin: list all assigned users for a coupon
router.get('/admin/coupons/:id/assignments', protect, authorize('super_admin', 'admin', 'subadmin'), couponController.getCouponAssignments);

// Admin: revoke a single user's assignment
router.patch('/admin/coupons/:couponId/assignments/:userId', protect, authorize('super_admin', 'admin', 'subadmin'), couponController.revokeAssignment);

// Admin: list all users who used a coupon
router.get('/admin/coupons/:id/used-users', protect, authorize('super_admin', 'admin', 'subadmin'), couponController.getUsedUsers);

module.exports = router;
