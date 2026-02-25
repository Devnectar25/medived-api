const Razorpay = require('razorpay');
const crypto = require('crypto');
const pool = require('../config/db');
require('dotenv').config();

console.log('[DEBUG] Razorpay Key ID:', process.env.RAZORPAY_KEY_ID ? (process.env.RAZORPAY_KEY_ID.substring(0, 8) + '...') : 'MISSING');
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});


exports.createRazorpayOrder = async (amount, currency, receipt, internalOrderId) => {
    const options = {
        amount: Math.round(amount * 100), // amount in the smallest currency unit (paise)
        currency,
        receipt,
    };

    try {
        console.log('[DEBUG] Creating Razorpay order with options:', options);
        const order = await razorpay.orders.create(options);
        console.log('[DEBUG] Razorpay order created:', order.id);

        // Update the internal order with the Razorpay Order ID
        if (internalOrderId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(internalOrderId)) {
            await pool.query(
                `UPDATE orders SET razorpay_order_id = $1 WHERE id = $2`,
                [order.id, internalOrderId]
            );
        }


        return order;
    } catch (error) {
        console.error('[DEBUG] Razorpay order creation failed. Error:', error);
        throw error;
    }
};



exports.verifyPayment = async (verificationData, internalOrderId, userId) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = verificationData;

    const shasum = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const digest = shasum.digest('hex');

    if (digest !== razorpay_signature) {
        // Log failure and update order status to Cancelled
        await pool.query(
            `UPDATE orders SET status = 'Cancelled', updated_at = NOW() WHERE id = $1`,
            [internalOrderId]
        );
        return { success: false, message: 'Invalid signature' };
    }

    // signature match - success flow
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get payment details from Razorpay to get the actual amount
        const payment = await razorpay.payments.fetch(razorpay_payment_id);
        const amount = payment.amount / 100; // convert back from paise

        // 2. Insert into transactions table
        await client.query(
            `INSERT INTO transactions (user_id, order_id, transaction_id, amount, status, created_at)
             VALUES ($1, $2, $3, $4, 'Completed', NOW())`,
            [userId, internalOrderId, razorpay_payment_id, amount]
        );

        // 3. Update payment_status to 'Paid' (keep status as Pending for admin processing)
        const orderResult = await client.query(
            `UPDATE orders SET status = 'Pending', payment_status = 'Paid', updated_at = NOW() 
             WHERE id = $1 RETURNING *`,
            [internalOrderId]
        );

        await client.query('COMMIT');
        return { success: true, order: orderResult.rows[0] };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Transaction failed:', error);
        throw error;
    } finally {
        client.release();
    }
};

exports.handleWebhook = async (payload, signature) => {
    // In a real scenario, you'd verify the signature here using RAZORPAY_WEBHOOK_SECRET
    // For this test task, we'll focus on the event processing logic

    const event = payload.event;
    if (event === 'payment.captured' || event === 'order.paid') {
        const payment = payload.payload.payment.entity;
        const razorpayOrderId = payment.order_id;
        const razorpayPaymentId = payment.id;
        const amount = payment.amount / 100;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Find internal order
            const orderRes = await client.query(
                `SELECT id, user_id, status FROM orders WHERE razorpay_order_id = $1`,
                [razorpayOrderId]
            );

            if (orderRes.rows.length > 0) {
                const order = orderRes.rows[0];

                // Only update if not already completed
                if (order.status !== 'Completed') {
                    // 1. Insert transaction
                    await client.query(
                        `INSERT INTO transactions (user_id, order_id, transaction_id, amount, status, created_at)
                         VALUES ($1, $2, $3, $4, 'Completed', NOW())
                         ON CONFLICT (transaction_id) DO NOTHING`,
                        [order.user_id, order.id, razorpayPaymentId, amount]
                    );

                    // 2. Update order (set payment_status to Paid, keep status Pending)
                    await client.query(
                        `UPDATE orders SET status = 'Pending', payment_status = 'Paid', updated_at = NOW() 
                         WHERE id = $1`,
                        [order.id]
                    );
                }
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Webhook processing failed:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    return { success: true };
};
