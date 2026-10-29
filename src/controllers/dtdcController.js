const dtdcService = require('../services/dtdcService');
const orderService = require('../services/orderService');

/**
 * 1. Book shipment with DTDC (Generates AWB & sets status to Shipped)
 */
exports.shipOrderWithDTDC = async (req, res) => {
    try {
        const { id } = req.params;
        const packageOptions = req.body || {};

        console.log(`[DTDCController] Initiating DTDC shipment for Order ID: ${id}`);
        const result = await dtdcService.createShipment(id, packageOptions);

        res.status(200).json({
            success: true,
            message: 'Order shipped successfully with DTDC',
            data: result
        });
    } catch (error) {
        console.error('[DTDCController] shipOrderWithDTDC Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to ship order with DTDC'
        });
    }
};

/**
 * 2. Download / Stream Shipping Label PDF
 */
exports.getShippingLabel = async (req, res) => {
    try {
        const { id } = req.params;
        let trackingNumber = req.query.trackingNumber;

        if (!trackingNumber) {
            const order = await orderService.getOrderById(id);
            if (!order) {
                return res.status(404).json({ success: false, message: 'Order not found' });
            }
            trackingNumber = order.tracking_number;
        }

        if (!trackingNumber) {
            return res.status(400).json({
                success: false,
                message: 'No tracking number associated with this order. Please ship the order first.'
            });
        }

        const pdfBuffer = await dtdcService.getShippingLabel(trackingNumber);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="DTDC_LABEL_${trackingNumber}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.end(pdfBuffer);
    } catch (error) {
        console.error('[DTDCController] getShippingLabel Error:', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to download shipping label'
            });
        }
    }
};

/**
 * 3. Track Consignment Live Status
 */
exports.trackShipment = async (req, res) => {
    try {
        const { id } = req.params;
        let trackingNumber = req.query.trackingNumber;

        // If UUID / order ID is passed, retrieve tracking number from DB
        if (!trackingNumber) {
            // Check if `id` itself is a tracking number or an order UUID
            if (id && id.length > 20 && id.includes('-')) {
                const order = await orderService.getOrderById(id);
                if (order) {
                    trackingNumber = order.tracking_number;
                }
            } else if (id) {
                trackingNumber = id;
            }
        }

        if (!trackingNumber) {
            return res.status(400).json({
                success: false,
                message: 'Tracking number not found for this order'
            });
        }

        const trackingData = await dtdcService.trackShipment(trackingNumber);

        res.status(200).json({
            success: true,
            data: trackingData
        });
    } catch (error) {
        console.error('[DTDCController] trackShipment Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch tracking details from DTDC'
        });
    }
};
