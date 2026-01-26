const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', authorize('admin'), orderController.getAllOrders);
router.post('/', orderController.createOrder);
router.get('/my-orders', orderController.getOrdersByUser);
router.get('/:id', orderController.getOrderById);
router.patch('/:id/status', authorize('admin'), orderController.updateOrderStatus);

module.exports = router;
