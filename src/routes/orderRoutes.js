const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', authorize('admin'), orderController.getAllOrders);
router.get('/admin/cancelled-orders', authorize('admin'), orderController.getCancelledOrders);
router.get('/stats', authorize('admin'), orderController.getOrderStats);
router.post('/', orderController.createOrder);
router.post('/reorder/select', orderController.reorderOrder); // For intelligent reorder flow
router.get('/my-orders', orderController.getOrdersByUser);
router.get('/:id', orderController.getOrderById);
router.get('/:id/invoice', orderController.downloadInvoice);
router.post('/:id/reorder', orderController.reorderOrder);
router.patch('/:id/status', orderController.updateOrderStatus);
router.patch('/:id/items/:itemId/status', authorize('admin'), orderController.updateOrderItemStatus);
router.patch('/:id/refund-status', authorize('admin'), orderController.updateRefundStatus);

router.post('/:id/return-request', orderController.requestReturnReplace);
router.patch('/:id/restock', authorize('admin'), orderController.restockOrder);

module.exports = router;
