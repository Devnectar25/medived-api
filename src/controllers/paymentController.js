const paymentService = require('../services/paymentService');

exports.createRazorpayOrder = async (req, res) => {
    try {
        console.log('[DEBUG] createRazorpayOrder request body:', req.body);
        const { amount, currency = 'INR', receipt, orderId } = req.body;
        const order = await paymentService.createRazorpayOrder(amount, currency, receipt, orderId);

        console.error('[DEBUG] createRazorpayOrder Success:', order.id);
        res.status(200).json({ success: true, data: order });
    } catch (error) {
        console.error('[DEBUG] Error in createRazorpayOrder:', error);
        res.status(500).json({
            success: false,
            message: error.description || error.message || 'Failed to initialize payment'
        });
    }
};

exports.verifyPayment = async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            order_id // app's internal order id
        } = req.body;

        const userId = req.user.id;

        const result = await paymentService.verifyPayment(
            { razorpay_order_id, razorpay_payment_id, razorpay_signature },
            order_id,
            userId
        );

        if (result.success) {
            res.status(200).json({ success: true, message: 'Payment verified and recorded', data: result.order });
        } else {
            res.status(400).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error in verifyPayment:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.handleWebhook = async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const result = await paymentService.handleWebhook(req.body, signature);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error in handleWebhook:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

