const orderService = require('../services/orderService');
const invoiceService = require('../services/invoiceService');
const bankAccountService = require('../services/bankAccountService');
const dtdcService = require('../services/dtdcService');

exports.createOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const orderData = { ...req.body, userId };
        const order = await orderService.createOrder(orderData);
        res.status(201).json({ success: true, data: order });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAllOrders = async (req, res) => {
    try {
        let page = parseInt(req.query.page) || 1;
        if (page < 1) page = 1;
        const limit = parseInt(req.query.limit) || 10;
        let offset = (page - 1) * limit;
        const status = req.query.status;
        const paymentStatus = req.query.paymentStatus;
        const type = req.query.type;
        const userName = req.query.userName;
        const orderNumber = req.query.orderNumber;
        const paymentType = req.query.paymentType;
        const dateFrom = req.query.dateFrom;
        const dateTo = req.query.dateTo;

        let result = await orderService.getAllOrders({ limit, offset, status, paymentStatus, type, userName, orderNumber, paymentType, dateFrom, dateTo });
        
        const totalPages = Math.ceil(result.totalCount / limit) || 1;
        let currentPage = page;

        // Auto-heal: If page requested exceeds totalPages (e.g. user was on page 10 and applied filter/search that only has 1 page)
        if (result.totalCount > 0 && page > totalPages) {
            currentPage = 1;
            result = await orderService.getAllOrders({ limit, offset: 0, status, paymentStatus, type, userName, orderNumber, paymentType, dateFrom, dateTo });
        }

        res.status(200).json({
            success: true,
            data: result.orders,
            pagination: {
                totalOrders: result.totalCount,
                currentPage: currentPage,
                totalPages: totalPages,
                limit: limit
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getCancelledOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const refundStatusFilter = req.query.refundStatusFilter || 'All';
        const searchTerm = req.query.searchTerm;

        const result = await orderService.getCancelledOrders({ limit, offset, refundStatusFilter, searchTerm });
        console.log(`[GET CANCELLED] Sending response with ${result.orders.length} orders (refundFilter: ${refundStatusFilter})`);
        res.status(200).json({
            success: true,
            data: result.orders,
            pagination: {
                totalOrders: result.totalCount,
                currentPage: page,
                totalPages: Math.ceil(result.totalCount / limit),
                limit: limit
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getCancelledOrdersStats = async (req, res) => {
    try {
        const stats = await orderService.getCancelledOrdersStats();
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getOrderStats = async (req, res) => {
    try {
        const stats = await orderService.getOrderStats();
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getOrdersByUser = async (req, res) => {
    try {
        const userId = req.user.id;
        const orders = await orderService.getOrdersByUser(userId);
        res.status(200).json({ success: true, data: orders });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getOrderById = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await orderService.getOrderById(id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        // Security check: only allow own user or admin
        if (order.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        res.status(200).json({ success: true, data: order });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, cancelReason, bankDetails, paymentStatus, itemIds, trackingNumber } = req.body;

        const order = await orderService.getOrderById(id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        // Security check
        const isAdmin = req.user.role === 'admin';
        const isOwner = order.user_id == req.user.id;

        if (!isAdmin) {
            if (!isOwner) {
                return res.status(403).json({ success: false, message: 'Not authorized' });
            }
            if (status !== 'Cancelled' && status !== 'Cancellation Requested') {
                return res.status(403).json({ success: false, message: 'Regular users can only cancel orders' });
            }
            // Enforce 24h limit for non-admins
            const createdTime = new Date(order.created_at).getTime();
            if (Date.now() - createdTime > 24 * 60 * 60 * 1000) {
                return res.status(400).json({ success: false, message: 'Order can only be cancelled within 24 hours of placement' });
            }
            // Cancellable statuses matches frontend UI logic - extended to allow Shipped/Out for Delivery within 24h
            const cancellableStatuses = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Cancellation Requested', 'Cancelled'];
            const orderStatus = order.status || 'Pending';
            if (!cancellableStatuses.includes(orderStatus) && orderStatus.toLowerCase() !== 'pending') {
                return res.status(400).json({ success: false, message: `Order with status '${orderStatus}' cannot be cancelled` });
            }
        }

        let cancelledBy = null;
        if (status === 'Cancelled') {
            if (isAdmin) {
                // If the user previously requested cancellation, it was customer-initiated
                if (order.status === 'Cancellation Requested' || order.status === 'CANCEL_REQUESTED') {
                    cancelledBy = 'customer';
                } else {
                    cancelledBy = 'admin';
                }
            } else {
                cancelledBy = 'customer';
            }
        }

        // Automatic DTDC consignment booking when an order is updated to 'Shipped' without an existing AWB
        if (status === 'Shipped' && (!order.tracking_number || order.tracking_number.startsWith('TRK-')) && !trackingNumber) {
            try {
                console.log(`[OrderController] Auto-booking DTDC shipment for order ${id}...`);
                const shipmentResult = await dtdcService.createShipment(id);
                console.log(`[OrderController] Auto-booked DTDC AWB: ${shipmentResult.trackingNumber}`);
                const freshOrder = await orderService.getOrderById(id);
                return res.status(200).json({ success: true, data: freshOrder });
            } catch (shipErr) {
                console.warn(`[OrderController] DTDC auto-booking on status change failed: ${shipErr.message}`);
            }
        }

        const updatedOrder = await orderService.updateOrderStatus(id, status, cancelReason, bankDetails, paymentStatus, itemIds, cancelledBy, trackingNumber);
        // Customer-submitted refund bank details (e.g. on cancellation) are saved to their account
        if (!isAdmin && bankDetails) await bankAccountService.rememberAccount(req.user.id, bankDetails);
        res.status(200).json({ success: true, data: updatedOrder });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

exports.downloadInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await orderService.getOrderById(id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        // Security check: only allow own user or admin
        if (order.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        // Invoices exist only for successfully delivered orders
        // (regular orders and replacement shipments once they reach the customer)
        if (!invoiceService.isInvoiceEligible(order)) {
            return res.status(400).json({
                success: false,
                message: 'Invoice is available only after the order has been delivered successfully.'
            });
        }

        const pdfBuffer = await invoiceService.generateInvoicePDF(id);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="HOMVED_INV_${order.order_number}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        res.end(pdfBuffer);
    } catch (error) {
        console.error('Invoice Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
};

exports.reorderOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const { orderId } = req.body;
        const targetId = id || orderId;
        const userId = req.user.id;

        if (!targetId) {
            return res.status(400).json({ success: false, message: 'Order ID is required' });
        }

        // Security check: only allow own user or admin
        const order = await orderService.getOrderById(targetId);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        if (order.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized to reorder this order' });
        }

        const result = await orderService.reorderOrder(order.id, userId);
        res.status(200).json(result);
    } catch (error) {
        console.error('Reorder Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateRefundStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const refundData = req.body;

        const updatedOrder = await orderService.updateRefundStatus(id, refundData);
        res.status(200).json({ success: true, data: updatedOrder });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

// QA inspection of a returned / replacement parcel received at Homved
exports.recordQaInspection = async (req, res) => {
    try {
        const { id } = req.params;
        const { result, notes } = req.body || {};
        if (!['pass', 'fail'].includes(result)) {
            return res.status(400).json({ success: false, message: 'result must be "pass" or "fail"' });
        }
        const checkedBy = req.user?.username || req.user?.emailid || req.user?.id || 'admin';
        const data = await orderService.recordQaInspection(id, { passed: result === 'pass', notes, checkedBy: String(checkedBy) });
        res.status(200).json({
            success: true,
            message: result === 'pass' ? 'Parcel passed QA inspection' : 'Parcel failed QA inspection',
            data
        });
    } catch (error) {
        console.error('[OrderController] recordQaInspection Error:', error.message);
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};
exports.restockOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await orderService.restockOrder(id);
        res.status(200).json({ success: true, data: order, message: "Inventory successfully restocked" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.requestReturnReplace = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        console.log(`[OrderController] requestReturnReplace: Order=${id}, User=${userId}, Type=${req.body?.type}`);
        const result = await orderService.requestReturnReplace(id, userId, req.body);
        // Remember the refund bank account so the customer never has to re-enter it
        if (req.body?.bankDetails) await bankAccountService.rememberAccount(userId, req.body.bankDetails);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('[OrderController] requestReturnReplace Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.requestItemCancellation = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const isAdmin = req.user.role === 'admin';
        console.log(`[OrderController] requestItemCancellation: ID=${id}, User=${userId}, isAdmin=${isAdmin}`);
        const result = await orderService.requestItemCancellation(id, userId, req.body, isAdmin);
        if (!isAdmin && req.body?.bankDetails) await bankAccountService.rememberAccount(userId, req.body.bankDetails);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('[OrderController] requestItemCancellation error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateOrderItemStatus = async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const { status } = req.body;

        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Only admins can update order items individually' });
        }

        const updatedItem = await orderService.updateOrderItemStatus(id, itemId, status);
        res.status(200).json({ success: true, data: updatedItem });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getOrderApprovalMode = async (req, res) => {
    try {
        const mode = await orderService.getOrderApprovalMode();
        res.status(200).json({ success: true, mode });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.setOrderApprovalMode = async (req, res) => {
    try {
        const { mode } = req.body;
        const updatedMode = await orderService.setOrderApprovalMode(mode);
        res.status(200).json({ success: true, mode: updatedMode });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateOrderAddress = async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await orderService.updateOrderAddress(id, req.body);
        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


exports.confirmReceivedAndCreateReplacement = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await orderService.confirmReceivedAndCreateReplacement(id);
        res.status(200).json({
            success: true,
            message: 'Original product confirmed received at store. Replacement order created successfully.',
            data: result
        });
    } catch (error) {
        console.error('[OrderController] confirmReceivedAndCreateReplacement Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};


exports.getOrderRefundCalculation = async (req, res) => {
    try {
        const { id } = req.params;
        const calculation = await orderService.calculateOrderRefundBreakdown(id);
        res.status(200).json({ success: true, data: calculation });
    } catch (error) {
        console.error('[OrderController] getOrderRefundCalculation Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};


exports.deleteAbandonedOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id || req.user?.username || null;
        const result = await orderService.deleteAbandonedOrder(id, userId);
        res.status(200).json(result);
    } catch (error) {
        console.error('[OrderController] deleteAbandonedOrder Error:', error);
        res.status(400).json({ success: false, message: error.message || 'Failed to delete abandoned order' });
    }
};
