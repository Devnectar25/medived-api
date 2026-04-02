const orderService = require('../services/orderService');
const invoiceService = require('../services/invoiceService');

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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const status = req.query.status;
        const paymentStatus = req.query.paymentStatus;
        const type = req.query.type;

        const result = await orderService.getAllOrders({ limit, offset, status, paymentStatus, type });
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

exports.getCancelledOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const result = await orderService.getCancelledOrders({ limit, offset });
        console.log(`[GET CANCELLED] Sending response with ${result.orders.length} orders`);
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
        const { status, cancelReason, bankDetails, paymentStatus, itemIds } = req.body;

        const order = await orderService.getOrderById(id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        // Security check
        const isAdmin = req.user.role === 'admin';
        const isOwner = order.user_id == req.user.id;

        if (!isAdmin) {
            if (!isOwner) {
                return res.status(403).json({ success: false, message: 'Not authorized' });
            }
            if (status !== 'Cancelled' && status !== 'Cancellation Processing') {
                return res.status(403).json({ success: false, message: 'Regular users can only cancel orders' });
            }
            // Enforce 24h limit for non-admins
            const createdTime = new Date(order.created_at).getTime();
            if (Date.now() - createdTime > 24 * 60 * 60 * 1000) {
                return res.status(400).json({ success: false, message: 'Order can only be cancelled within 24 hours of placement' });
            }
            // Cancellable statuses matches frontend UI logic - extended to allow Shipped/Out for Delivery within 24h
            const cancellableStatuses = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Cancellation Processing', 'Cancelled'];
            const orderStatus = order.status || 'Pending';
            if (!cancellableStatuses.includes(orderStatus) && orderStatus.toLowerCase() !== 'pending') {
                return res.status(400).json({ success: false, message: `Order with status '${orderStatus}' cannot be cancelled` });
            }
        }

        const updatedOrder = await orderService.updateOrderStatus(id, status, cancelReason, bankDetails, paymentStatus, itemIds);
        res.status(200).json({ success: true, data: updatedOrder });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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

        const result = await orderService.reorderOrder(targetId, userId);
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
        res.status(500).json({ success: false, message: error.message });
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
        const result = await orderService.requestReturnReplace(id, userId, req.body);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
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
