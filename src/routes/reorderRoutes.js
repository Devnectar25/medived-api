const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { protect } = require('../middlewares/authMiddleware');

// Matches /api/reorder/select exactly as requested
router.post('/reorder/select', protect, orderController.reorderOrder);

module.exports = router;
