const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const dtdcController = require('../controllers/dtdcController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Public tracking endpoint (accessible with tracking number)
router.get('/tracking/:id', dtdcController.trackShipment);

router.use(protect);

router.get('/', authorize('admin'), orderController.getAllOrders);
router.get('/admin/approval-mode', authorize('admin'), orderController.getOrderApprovalMode);
router.post('/admin/approval-mode', authorize('admin'), orderController.setOrderApprovalMode);
router.get('/admin/cancelled-orders', authorize('admin'), orderController.getCancelledOrders);
router.get('/stats', authorize('admin'), orderController.getOrderStats);
router.post('/', orderController.createOrder);
router.post('/reorder/select', orderController.reorderOrder); // For intelligent reorder flow
router.get('/my-orders', orderController.getOrdersByUser);

// DTDC Logistics Integration Endpoints
router.post('/:id/dtdc/ship', authorize('admin'), dtdcController.shipOrderWithDTDC);
router.get('/:id/dtdc/label', authorize('admin'), dtdcController.getShippingLabel);
router.get('/:id/dtdc/track', dtdcController.trackShipment);

router.get('/:id', orderController.getOrderById);
router.get('/:id/invoice', orderController.downloadInvoice);
router.post('/:id/reorder', orderController.reorderOrder);
router.patch('/:id/status', orderController.updateOrderStatus);
router.patch('/:id/address', authorize('admin'), orderController.updateOrderAddress);
router.patch('/:id/items/:itemId/status', authorize('admin'), orderController.updateOrderItemStatus);
router.patch('/:id/refund-status', authorize('admin'), orderController.updateRefundStatus);

router.post('/:id/return-request', orderController.requestReturnReplace);
router.post('/:id/cancel-item', orderController.requestItemCancellation);
router.post('/:id/replacement/create-order', authorize('admin'), orderController.confirmReceivedAndCreateReplacement);
router.patch('/:id/restock', authorize('admin'), orderController.restockOrder);

module.exports = router;

