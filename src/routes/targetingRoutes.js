const express = require('express');
const router = express.Router();
const targetingController = require('../controllers/targetingController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// All targeting routes are protected admin/subadmin only
router.use(protect);
router.use(authorize('super_admin', 'admin', 'subadmin'));

// GET /api/admin/targeting/top-customers
router.get('/top-customers', targetingController.getTopCustomers);

// GET /api/admin/targeting/users
router.get('/users', targetingController.getAllUsers);

// GET /api/admin/targeting/active-users
router.get('/active-users', targetingController.getActiveUsers);

// POST /api/admin/targeting/assign-coupon
router.post('/assign-coupon', targetingController.assignCoupon);

module.exports = router;
