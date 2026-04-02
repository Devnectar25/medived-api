const Razorpay = require('razorpay');
const pool = require('../config/db');
const receiptService = require('../services/refundReceiptService');
const storageService = require('../services/storageService');

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

exports.initiateRazorpayRefund = async (req, res) => {
    const client = await pool.connect();
    try {
        const { orderId } = req.body;
        
        if (!orderId) {
            return res.status(400).json({ success: false, message: "Order ID is required" });
        }

        // 1. Fetch order details (Razorpay Payment ID and Amount)
        const orderRes = await client.query(
            `SELECT o.*, 
                    u.username as "customer_name",
                    u.contactno as "customer_phone_db",
                    a.full_address, 
                    a.city, 
                    a.state, 
                    a.postal_code
             FROM orders o
             LEFT JOIN users u ON o.user_id = u.username
             LEFT JOIN user_addresses a ON o.address_id = a.id
             WHERE o.id = $1`,
            [orderId]
        );

        if (orderRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const rawOrder = orderRes.rows[0];
        
        // Structure address and customer info for template compatibility
        const order = {
            ...rawOrder,
            customerPhone: rawOrder.customer_phone_db || rawOrder.user_id,
            shippingAddress: {
                // Mocking first/last name from username similar to frontend mapping
                firstName: rawOrder.customer_name || rawOrder.user_id || 'Customer',
                lastName: '',
                phone: rawOrder.customer_phone_db || '',
                address: rawOrder.full_address || '',
                city: rawOrder.city || '',
                state: rawOrder.state || '',
                pincode: rawOrder.postal_code || ''
            }
        };

        // 2. Validation
        let paymentId = order.razorpay_payment_id;
        const { manualPaymentId } = req.body;

        if (!paymentId && manualPaymentId) {
            console.log(`[REFUND] Using manually provided Payment ID: ${manualPaymentId}`);
            paymentId = manualPaymentId;
        }

        if (order.payment_method?.toLowerCase() === 'cod') {
            return res.status(400).json({ success: false, message: "Automated refund not possible for COD orders. Use manual verification." });
        }

        if (!paymentId) {
            return res.status(400).json({ 
                success: false, 
                message: "Razorpay Payment ID not found for this order. Only online payments can be refunded automatically.",
                requiresManualId: true 
            });
        }

        if (order.refund_status === 'Completed' || order.refund_status === 'Refunded') {
            return res.status(400).json({ success: false, message: "Order already marked as refunded." });
        }

        console.log(`[REFUND] Initiating Razorpay refund for Order #${order.order_number}, Payment: ${paymentId}`);

        // 3. Trigger Razorpay Refund
        const refundAmount = Math.round(order.total * 100);
        const refundResponse = await razorpay.payments.refund(paymentId, {
            amount: refundAmount,
            notes: {
                reason: "Customer cancellation / Admin refund",
                order_id: order.id,
                order_number: order.order_number
            }
        });

        console.log(`[REFUND] Razorpay Success! Refund ID: ${refundResponse.id}`);

        // 4. Generate Automated Refund Receipt Slip (PDF)
        let receiptUrl = '';
        try {
            console.log(`[REFUND] Generating automated receipt PDF...`);
            const pdfBuffer = await receiptService.generateRefundReceiptPDF(order, refundResponse.id);
            const fileName = `refunds/slip-${order.order_number}-${refundResponse.id}`;
            receiptUrl = await storageService.uploadBuffer(pdfBuffer, fileName, 'application/pdf');
            console.log(`[REFUND] Receipt uploaded: ${receiptUrl}`);
        } catch (pdfErr) {
            console.error("⚠️ Failed to generate automated receipt PDF, will proceed with status update only.", pdfErr);
        }

        // 5. Update Database
        await client.query('BEGIN');

        const updateResult = await client.query(
            `UPDATE orders 
             SET refund_status = 'Completed',
                 refund_id = $2,
                 refund_txn_id = $2,
                 razorpay_payment_id = COALESCE(razorpay_payment_id, $4),
                 refund_receipt_url = COALESCE(NULLIF($3::text, ''), refund_receipt_url),
                 refund_processed_at = NOW(),
                 status = 'Refunded',
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [orderId, refundResponse.id, receiptUrl, paymentId]
        );

        await client.query('COMMIT');

        res.status(200).json({
            success: true,
            message: "Refund processed successfully via Razorpay",
            data: updateResult.rows[0],
            refundId: refundResponse.id,
            receiptUrl: receiptUrl
        });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error("[REFUND ERROR]", error);
        
        // Specific error handling for Razorpay balance issues etc.
        const errorMessage = error.description || error.message || "Failed to initiate Razorpay refund";
        res.status(500).json({ success: false, message: errorMessage });
    } finally {
        client.release();
    }
};
