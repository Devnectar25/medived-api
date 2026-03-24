const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', authorize('admin'), orderController.getAllOrders);
router.get('/stats', authorize('admin'), orderController.getOrderStats);
router.post('/', orderController.createOrder);
router.post('/reorder/select', orderController.reorderOrder); // For intelligent reorder flow
router.get('/my-orders', orderController.getOrdersByUser);
router.get('/:id', orderController.getOrderById);
router.get('/:id/invoice', orderController.downloadInvoice);
router.post('/:id/reorder', orderController.reorderOrder);
router.patch('/:id/status', orderController.updateOrderStatus);

module.exports = router;
