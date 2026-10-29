/**
 * DTDC Courier Integration Service
 * Implements:
 * 1. Consignment Creation (Softdata): POST /api/customer/integration/consignment/softdata
 * 2. Shipping Label PDF Stream: GET /api/customer/integration/consignment/shippinglabel/stream
 * 3. Live Tracking Details: POST /dtdc-api/rest/JSONCnTrk/getTrackDetails
 * 4. Tracking Authentication (Token Renewal): GET /api/dtdc/authenticate
 */

const pool = require('../config/db');

// Default DTDC Credentials (can be overridden via environment variables)
const DTDC_API_KEY = process.env.DTDC_API_KEY || 'ee2b3254c59f462f8bd2f65ff2622c';
const DTDC_CUSTOMER_CODE = process.env.DTDC_CUSTOMER_CODE || 'GL16207';
const DTDC_BASE_URL = process.env.DTDC_BASE_URL || 'https://pxapi.dtdc.in';

const DTDC_TRACK_BASE_URL = process.env.DTDC_TRACK_BASE_URL || 'https://blktracksvc.dtdc.com';
const DTDC_TRACK_USERNAME = process.env.DTDC_TRACK_USERNAME || 'GL16207_trk_json';
const DTDC_TRACK_PASSWORD = process.env.DTDC_TRACK_PASSWORD || 'Q1r6I';

// In-memory access token cache for tracking
let cachedTrackingToken = process.env.DTDC_TRACK_ACCESS_TOKEN || 'GL16207_trk_json:db9b48785a778c8b4fa913229f4a6183';

// Homved Warehouse / Dispatch Center Origin
const HOMVED_ORIGIN = {
    name: "Homved Medicine Center",
    phone: "9075669251",
    alternate_phone: "0000000000",
    address_line_1: "63-2 Bombay Talkies Comp, Himansuroy Road Malad W, Malad, Mumbai",
    address_line_2: "",
    pincode: "400064",
    city: "Mumbai",
    latitude: "",
    longitude: "",
    state: "Maharashtra"
};

/**
 * Helper to fetch a fresh tracking access token if expired
 */
async function refreshTrackingToken() {
    try {
        console.log('[DTDC] Refreshing tracking access token via API #4...');
        const authUrl = `${DTDC_TRACK_BASE_URL}/dtdcapi/api/dtdc/authenticate?username=${encodeURIComponent(DTDC_TRACK_USERNAME)}&password=${encodeURIComponent(DTDC_TRACK_PASSWORD)}`;
        const response = await fetch(authUrl, { method: 'GET' });
        
        // Some DTDC servers return token in header or body
        const tokenFromHeader = response.headers.get('x-access-token');
        const text = await response.text();
        
        if (tokenFromHeader) {
            cachedTrackingToken = tokenFromHeader;
            return cachedTrackingToken;
        }
        
        if (text && text.trim().length > 0) {
            try {
                const parsed = JSON.parse(text);
                if (parsed.token || parsed.access_token || parsed['x-access-token']) {
                    cachedTrackingToken = parsed.token || parsed.access_token || parsed['x-access-token'];
                    return cachedTrackingToken;
                }
            } catch (e) {
                // Text might be raw token string
                cachedTrackingToken = text.trim();
                return cachedTrackingToken;
            }
        }

        console.log('[DTDC] Auth returned status:', response.status);
        return cachedTrackingToken;
    } catch (err) {
        console.error('[DTDC] Failed to refresh tracking token:', err.message);
        return cachedTrackingToken;
    }
}

/**
 * 1. Book Consignment / Generate AWB with DTDC (Softdata)
 */
exports.createShipment = async (orderId, packageOptions = {}) => {
    // Fetch order details with shipping address
    const orderQuery = `
        SELECT o.*, 
               u.fullname AS customer_name, 
               u.emailid AS customer_email, 
               u.contactno AS customer_phone, 
               a.full_address, 
               a.city, 
               a.state, 
               a.postal_code, 
               a.address_label,
               (
                   SELECT json_agg(items_data)
                   FROM (
                       SELECT * FROM order_items WHERE order_id = o.id
                   ) items_data
               ) as items
        FROM orders o
        LEFT JOIN user_addresses a ON o.address_id = a.id
        LEFT JOIN users u ON o.user_id = u.username
        WHERE o.id = $1
    `;
    const orderRes = await pool.query(orderQuery, [orderId]);
    if (orderRes.rows.length === 0) {
        throw new Error('Order not found');
    }

    const order = orderRes.rows[0];

    // Destination details validation
    const destName = (order.customer_name || 'Customer').trim();
    const destPhone = (order.customer_phone || '9999999999').replace(/[^0-9]/g, '').slice(-10) || '9999999999';
    const destAddress = (order.full_address || 'Customer Address').trim();
    const destCity = (order.city || 'Mumbai').trim();
    const destState = (order.state || 'Maharashtra').trim();
    const destPincode = (order.postal_code || '').trim();

    if (!destPincode) {
        throw new Error('Destination pincode is missing for this order.');
    }

    // Determine COD details
    const isCOD = (order.payment_method === 'cod' || order.payment_type === 'COD');
    const codAmount = isCOD ? Math.round(parseFloat(order.total || 0)).toString() : "";
    const codCollectionMode = isCOD ? "cash" : "";

    // Package dimensions and weight defaults
    const length = (packageOptions.length || 10).toString();
    const width = (packageOptions.width || 10).toString();
    const height = (packageOptions.height || 10).toString();
    const weight = (packageOptions.weight || 0.5).toString();
    const declaredValue = Math.round(parseFloat(order.total || 500)).toString();

    // Prepare softdata payload
    const payload = {
        consignments: [
            {
                customer_code: DTDC_CUSTOMER_CODE,
                service_type_id: "B2C PRIORITY",
                load_type: "NON-DOCUMENT",
                consignment_type: "Forward",
                description: "Homved Healthcare Products",
                dimension_unit: "cm",
                length: length,
                width: width,
                height: height,
                weight_unit: "kg",
                weight: weight,
                declared_value: declaredValue,
                num_pieces: "1",
                origin_details: {
                    name: HOMVED_ORIGIN.name,
                    phone: HOMVED_ORIGIN.phone,
                    alternate_phone: HOMVED_ORIGIN.alternate_phone,
                    address_line_1: HOMVED_ORIGIN.address_line_1,
                    address_line_2: HOMVED_ORIGIN.address_line_2,
                    pincode: HOMVED_ORIGIN.pincode,
                    city: HOMVED_ORIGIN.city,
                    latitude: HOMVED_ORIGIN.latitude,
                    longitude: HOMVED_ORIGIN.longitude,
                    state: HOMVED_ORIGIN.state
                },
                destination_details: {
                    name: destName,
                    phone: destPhone,
                    alternate_phone: "0000000000",
                    address_line_1: destAddress,
                    address_line_2: "",
                    pincode: destPincode,
                    city: destCity,
                    latitude: "",
                    longitude: "",
                    state: destState
                },
                return_details: {
                    name: HOMVED_ORIGIN.name,
                    phone: HOMVED_ORIGIN.phone,
                    address_line_1: HOMVED_ORIGIN.address_line_1,
                    address_line_2: HOMVED_ORIGIN.address_line_2,
                    pincode: HOMVED_ORIGIN.pincode,
                    city_name: HOMVED_ORIGIN.city,
                    latitude: HOMVED_ORIGIN.latitude,
                    longitude: HOMVED_ORIGIN.longitude,
                    state_name: HOMVED_ORIGIN.state,
                    alternate_phone: HOMVED_ORIGIN.alternate_phone
                },
                customer_reference_number: order.order_number,
                cod_collection_mode: codCollectionMode,
                cod_amount: codAmount,
                commodity_id: "Medicine",
                eway_bill: "",
                is_risk_surcharge_applicable: "false",
                invoice_number: `INV-${order.order_number}`,
                invoice_date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
                reference_number: ""
            }
        ]
    };

    console.log(`[DTDC] Creating shipment for Order ${order.order_number}...`);

    const response = await fetch(`${DTDC_BASE_URL}/api/customer/integration/consignment/softdata`, {
        method: 'POST',
        headers: {
            'api-key': DTDC_API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const responseData = await response.json();
    console.log('[DTDC] Softdata Response:', JSON.stringify(responseData, null, 2));

    if (responseData.status !== 'OK' || !responseData.data || !responseData.data[0]) {
        const errorMsg = responseData.error?.message || responseData.message || 'DTDC failed to book consignment';
        throw new Error(`DTDC Error: ${errorMsg}`);
    }

    const consignment = responseData.data[0];
    if (!consignment.success || !consignment.reference_number) {
        const rawMsg = consignment.message || 'No tracking reference returned';
        if (rawMsg.includes('Special destination not enabled')) {
            throw new Error(`Special Destination Not Enabled: Pincode ${destPincode} is flagged by DTDC as an Out of Delivery Area (remote/special destination). Your client's DTDC account settings currently restrict special destinations. Please ask the client to enable "Special Destinations" in their DTDC account, or verify the destination pincode.`);
        }
        throw new Error(`DTDC Booking Failed: ${rawMsg}`);
    }

    const trackingNumber = consignment.reference_number; // e.g. 7X116099373

    // Update order in database
    const updateRes = await pool.query(
        `UPDATE orders 
         SET tracking_number = $1, 
             logistics_provider = 'DTDC', 
             logistics_status = 'Booked',
             status = CASE WHEN status IN ('Pending', 'Confirmed', 'Processing') THEN 'Shipped' ELSE status END,
             updated_at = NOW()
         WHERE id = $2 
         RETURNING *`,
        [trackingNumber, orderId]
    );

    return {
        success: true,
        trackingNumber: trackingNumber,
        customerReferenceNumber: consignment.customer_reference_number,
        order: updateRes.rows[0],
        dtdcResponse: consignment
    };
};

/**
 * 2. Get Shipping Label PDF stream / buffer from DTDC
 */
exports.getShippingLabel = async (trackingNumber) => {
    if (!trackingNumber || trackingNumber.startsWith('TRK-')) {
        throw new Error(`Tracking number "${trackingNumber}" is a temporary placeholder. Please click "Ship with DTDC" first to generate an official DTDC AWB consignment.`);
    }

    const url = `${DTDC_BASE_URL}/api/customer/integration/consignment/shippinglabel/stream?reference_number=${encodeURIComponent(trackingNumber)}&label_code=SHIP_LABEL_4X6&label_format=pdf`;
    
    console.log(`[DTDC] Requesting shipping label for AWB: ${trackingNumber}`);

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'api-key': DTDC_API_KEY
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error('[DTDC] Label print error response:', errText);
        if (errText.includes('CONSIGNMENT_NOT_FOUND') || errText.includes('does not belong to customer')) {
            throw new Error(`Consignment "${trackingNumber}" was not found in DTDC. Please click "Ship with DTDC" to book the shipment and generate an official label.`);
        }
        throw new Error(`Failed to fetch label from DTDC (${response.status}): ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
};

/**
 * 3. Track Consignment Live Status from DTDC
 */
exports.trackShipment = async (trackingNumber) => {
    if (!trackingNumber) {
        throw new Error('Tracking number is required for tracking');
    }

    const trackUrl = `${DTDC_TRACK_BASE_URL}/dtdc-api/rest/JSONCnTrk/getTrackDetails`;

    let token = cachedTrackingToken;

    const executeTrack = async (currentToken) => {
        return await fetch(trackUrl, {
            method: 'POST',
            headers: {
                'x-access-token': currentToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                trkType: 'cnno',
                strcnno: trackingNumber,
                addtnlDtl: 'Y'
            })
        });
    };

    let response = await executeTrack(token);

    // If 401 Unauthorized, refresh token and retry once
    if (response.status === 401) {
        console.warn('[DTDC] Tracking token unauthorized. Attempting refresh...');
        token = await refreshTrackingToken();
        response = await executeTrack(token);
    }

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`DTDC Tracking API returned status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    console.log('[DTDC] Track API raw response:', JSON.stringify(data, null, 2));

    // Handle "No data found" case (shipment newly created, waiting for pickup scan)
    if (data.errorDetails && data.errorDetails.includes('NO DATA FOUND')) {
        return {
            success: true,
            trackingNumber: trackingNumber,
            currentStatus: 'Manifested / Ready for Pickup',
            statusCategory: 'Booked',
            origin: HOMVED_ORIGIN.city,
            destination: 'Destination Hub',
            bookedDate: new Date().toISOString(),
            isDelivered: false,
            timeline: [
                {
                    action: 'Shipment Booked (Softdata)',
                    date: new Date().toLocaleDateString('en-GB'),
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    location: HOMVED_ORIGIN.city,
                    remarks: 'Shipment created electronically with DTDC. Ready for carrier handover.'
                }
            ],
            raw: data
        };
    }

    const header = data.trackHeader || {};
    const details = data.trackDetails || [];

    const currentStatus = header.strStatus || 'In Transit';
    const isDelivered = (currentStatus.toLowerCase() === 'delivered');

    // Auto-sync order in DB if marked Delivered
    if (isDelivered) {
        try {
            await pool.query(
                `UPDATE orders 
                 SET status = 'Delivered', 
                     delivered_at = COALESCE(delivered_at, NOW()), 
                     updated_at = NOW() 
                 WHERE tracking_number = $1 AND status != 'Delivered'`,
                [trackingNumber]
            );
        } catch (dbErr) {
            console.error('[DTDC] Failed to auto-update order to Delivered:', dbErr);
        }
    }

    // Format milestones timeline cleanly
    const formattedTimeline = details.map(item => ({
        action: item.strAction || 'Status Update',
        date: item.strActionDate ? `${item.strActionDate.substring(0, 2)}/${item.strActionDate.substring(2, 4)}/${item.strActionDate.substring(4)}` : '',
        time: item.strActionTime ? `${item.strActionTime.substring(0, 2)}:${item.strActionTime.substring(2, 4)}` : '',
        location: item.strOrigin || item.strDestination || '',
        remarks: item.sTrRemarks || '',
        code: item.strCode || ''
    }));

    return {
        success: true,
        trackingNumber: trackingNumber,
        currentStatus: currentStatus,
        statusCategory: isDelivered ? 'Delivered' : currentStatus.toLowerCase().includes('out') ? 'Out for Delivery' : 'In Transit',
        origin: header.strOrigin || HOMVED_ORIGIN.city,
        destination: header.strDestination || '',
        bookedDate: header.strBookedDate ? `${header.strBookedDate.substring(0, 2)}/${header.strBookedDate.substring(2, 4)}/${header.strBookedDate.substring(4)}` : '',
        bookedTime: header.strBookedTime || '',
        weight: `${header.strWeight || ''} ${header.strWeightUnit || ''}`.trim(),
        pieces: header.strPieces || '1',
        isDelivered: isDelivered,
        timeline: formattedTimeline.reverse(), // most recent first
        raw: data
    };
};
