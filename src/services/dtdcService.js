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
const DTDC_REVERSE_CUSTOMER_CODE = process.env.DTDC_REVERSE_CUSTOMER_CODE || DTDC_CUSTOMER_CODE;
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
    address_line_1: "63-2 Bombay Talkies Compound",
    address_line_2: "Himansuroy Road, Malad West",
    pincode: "400064",
    city: "Mumbai",
    latitude: "",
    longitude: "",
    state: "Maharashtra"
};

/**
 * Checks if DTDC API error message indicates the account is restricted to forward-only consignments
 */
function isForwardCustomerError(msg) {
    if (!msg || typeof msg !== 'string') return false;
    const lower = msg.toLowerCase();
    return (
        lower.includes('forward customer') ||
        lower.includes('invalid consignment type') ||
        lower.includes('reverse consignment') ||
        lower.includes('customer type')
    );
}

/**
 * Format string into Title Case (e.g. "dhule" -> "Dhule", "maharashtra" -> "Maharashtra")
 */
function formatTitleCase(str) {
    if (!str) return '';
    return str.toString().toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').trim();
}

/**
 * Sanitize and structure address details specifically for DTDC Softdata API & 4x6 Label Generation
 * - Extracts clean recipient name if full_address starts with a name prefix
 * - Strips duplicate name from street address
 * - Intelligently splits street address into address_line_1 (max 38 chars) & address_line_2 (max 38 chars)
 * - Formats city and state in Title Case
 */
function sanitizeDTDCAddress(order) {
    let rawAddress = (order.full_address || '').trim();
    let recipientName = (order.customer_name || '').trim();

    // If full_address starts with a name prefix followed by comma (e.g. "Gayatri Badgujar, lane no.6, kusumba")
    if (rawAddress.includes(',')) {
        const firstCommaIndex = rawAddress.indexOf(',');
        const possibleName = rawAddress.substring(0, firstCommaIndex).trim();
        const remainder = rawAddress.substring(firstCommaIndex + 1).trim();

        // If possibleName has letters only (no digits) and reasonable length
        if (possibleName && !/\d/.test(possibleName) && possibleName.length >= 2 && possibleName.length <= 40 && remainder.length > 0) {
            if (!recipientName || recipientName.toLowerCase() === 'customer' || recipientName.includes('@')) {
                recipientName = possibleName;
            }
            rawAddress = remainder;
        }
    }

    // Strip recipientName if clean address still starts with it
    if (recipientName && rawAddress.toLowerCase().startsWith(recipientName.toLowerCase())) {
        rawAddress = rawAddress.substring(recipientName.length).replace(/^[\s,]+/, '').trim() || rawAddress;
    }

    const finalName = formatTitleCase(recipientName || order.fullname || 'Customer').slice(0, 40) || 'Customer';
    const destPhone = (order.customer_phone || '9999999999').replace(/[^0-9]/g, '').slice(-10) || '9999999999';
    const destPincode = (order.postal_code || '').toString().trim();

    let cleanStreet = rawAddress || 'Customer Address';
    let city = (order.city || '').toString().trim();
    let state = (order.state || '').toString().trim();

    const finalCity = formatTitleCase(city) || 'Mumbai';
    const finalState = formatTitleCase(state) || 'Maharashtra';

    // Split cleanStreet across address_line_1 and address_line_2 (max 38 chars each for DTDC thermal labels)
    let addrLine1 = cleanStreet;
    let addrLine2 = '';

    if (cleanStreet.length > 35) {
        let splitIdx = cleanStreet.lastIndexOf(',', 35);
        if (splitIdx === -1 || splitIdx < 12) {
            splitIdx = cleanStreet.lastIndexOf(' ', 35);
        }
        if (splitIdx !== -1 && splitIdx >= 10) {
            addrLine1 = cleanStreet.substring(0, splitIdx).replace(/,+$/, '').trim();
            addrLine2 = cleanStreet.substring(splitIdx + 1).replace(/^[, ]+/, '').trim();
        } else {
            addrLine1 = cleanStreet.substring(0, 35).trim();
            addrLine2 = cleanStreet.substring(35).trim();
        }
    }

    // In DTDC Softdata, if addrLine2 is empty, provide locality or city so line 2 isn't blank
    if (!addrLine2) {
        addrLine2 = `${finalCity}, ${destPincode}`;
    }

    addrLine1 = addrLine1.slice(0, 40).trim();
    addrLine2 = addrLine2.slice(0, 40).trim();

    return {
        name: finalName,
        phone: destPhone,
        address_line_1: addrLine1,
        address_line_2: addrLine2,
        city: finalCity,
        state: finalState,
        pincode: destPincode
    };
}

// ── Network timeouts (ms): DTDC calls must never hang an admin request indefinitely ──
const DTDC_TIMEOUT_MS = {
    booking: 30000,   // softdata consignment creation
    label: 30000,     // label PDF stream (~1-3s typical)
    tracking: 15000,  // track details (~50-150ms typical)
    auth: 15000,      // token renewal (~1s typical)
};

/** fetch() with a hard timeout and a readable error message */
async function fetchWithTimeout(url, options, timeoutMs, label) {
    const startedAt = Date.now();
    try {
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
        console.log(`[DTDC] ${label} -> HTTP ${response.status} in ${Date.now() - startedAt}ms`);
        return response;
    } catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
            throw new Error(`DTDC ${label} timed out after ${Math.round(timeoutMs / 1000)}s. DTDC servers may be slow; please try again.`);
        }
        throw new Error(`DTDC ${label} request failed: ${err.message}`);
    }
}

/** Parse a DTDC JSON response, surfacing HTML / plain-text error pages clearly */
async function readJson(response, label) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`DTDC ${label} returned an unexpected response (HTTP ${response.status}): ${text.slice(0, 200)}`);
    }
}

/**
 * Helper to fetch a fresh tracking access token if expired
 */
async function refreshTrackingToken() {
    try {
        console.log('[DTDC] Refreshing tracking access token via API #4...');
        // NOTE: path is /dtdc-api/ (with hyphen). /dtdcapi/ always returns 401.
        const authUrl = `${DTDC_TRACK_BASE_URL}/dtdc-api/api/dtdc/authenticate?username=${encodeURIComponent(DTDC_TRACK_USERNAME)}&password=${encodeURIComponent(DTDC_TRACK_PASSWORD)}`;
        const response = await fetchWithTimeout(authUrl, { method: 'GET' }, DTDC_TIMEOUT_MS.auth, 'auth');
        if (!response.ok) {
            console.error('[DTDC] Token renewal failed with status', response.status);
            return cachedTrackingToken;
        }
        
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
 * 1. Book Consignment / Generate AWB with DTDC (Softdata) - Forward
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

    // Destination details sanitization for DTDC
    const destDetails = sanitizeDTDCAddress(order);

    if (!destDetails.pincode) {
        throw new Error('Destination pincode is missing for this order.');
    }

    // Replacement (-REP) orders are free for the customer: never collect cash on delivery,
    // and declare the real product value (their order total is ₹0)
    const isReplacementOrder = order.is_replacement === true;
    let replacementValue = 0;
    if (isReplacementOrder) {
        replacementValue = parseFloat(order.original_total || 0);
        if (!(replacementValue > 0) && order.parent_order_id) {
            const parentItems = await pool.query(
                `SELECT product_id, price FROM order_items WHERE order_id = $1`,
                [order.parent_order_id]
            );
            const priceByProduct = new Map(parentItems.rows.map(r => [String(r.product_id), parseFloat(r.price) || 0]));
            replacementValue = (order.items || []).reduce(
                (sum, it) => sum + (priceByProduct.get(String(it.product_id)) || 0) * (parseInt(it.quantity) || 1), 0
            );
        }
    }

    // Determine COD details
    const isCOD = !isReplacementOrder && (order.payment_method === 'cod' || order.payment_type === 'COD');
    const codAmount = isCOD ? Math.round(parseFloat(order.total || 0)).toString() : "";
    const codCollectionMode = isCOD ? "cash" : "";

    // Package dimensions and weight defaults
    const length = (packageOptions.length || 10).toString();
    const width = (packageOptions.width || 10).toString();
    const height = (packageOptions.height || 10).toString();
    const weight = (packageOptions.weight || 0.5).toString();
    const baseValue = isReplacementOrder ? replacementValue : parseFloat(order.total || 0);
    const declaredValue = Math.round(baseValue > 0 ? baseValue : 500).toString();

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
                    name: destDetails.name,
                    phone: destDetails.phone,
                    alternate_phone: "0000000000",
                    address_line_1: destDetails.address_line_1,
                    address_line_2: destDetails.address_line_2,
                    pincode: destDetails.pincode,
                    city: destDetails.city,
                    latitude: "",
                    longitude: "",
                    state: destDetails.state
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

    const response = await fetchWithTimeout(`${DTDC_BASE_URL}/api/customer/integration/consignment/softdata`, {
        method: 'POST',
        headers: {
            'api-key': DTDC_API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    }, DTDC_TIMEOUT_MS.booking, 'booking');

    const responseData = await readJson(response, 'booking');
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

    const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
            'api-key': DTDC_API_KEY
        }
    }, DTDC_TIMEOUT_MS.label, 'label');

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
        return await fetchWithTimeout(trackUrl, {
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
        }, DTDC_TIMEOUT_MS.tracking, 'tracking');
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

    const data = await readJson(response, 'tracking');

    // Handle "No data found" case (shipment newly created, waiting for pickup scan).
    // DTDC has no scan time yet, so don't fabricate one from the current server time.
    const errorText = JSON.stringify(data.errorDetails || '');
    if (errorText.includes('NO DATA FOUND')) {
        return {
            success: true,
            trackingNumber: trackingNumber,
            currentStatus: 'Manifested / Ready for Pickup',
            statusCategory: 'Booked',
            origin: HOMVED_ORIGIN.city,
            destination: 'Destination Hub',
            bookedDate: '',
            isDelivered: false,
            timeline: [
                {
                    action: 'Shipment Booked (Softdata)',
                    date: '',
                    time: '',
                    location: HOMVED_ORIGIN.city,
                    remarks: 'Shipment created electronically with DTDC. Awaiting first pickup scan.'
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
            const deliveredRes = await pool.query(
                `UPDATE orders 
                 SET status = 'Delivered', 
                     payment_status = CASE 
                         WHEN LOWER(payment_method) = 'cod' AND payment_status NOT IN ('Refunded', 'Cancelled') THEN 'Paid' 
                         ELSE payment_status 
                     END,
                     payment_type = CASE 
                         WHEN LOWER(payment_method) = 'cod' THEN 'Paid' 
                         ELSE payment_type 
                     END,
                     delivered_at = COALESCE(delivered_at, NOW()), 
                     updated_at = NOW() 
                 WHERE tracking_number = $1 
                   AND status != 'Delivered'
                   AND status NOT IN ('Cancelled', 'Cancellation Requested', 'CANCEL_REQUESTED', 'Refunded')
                 RETURNING id, is_replacement, parent_order_id, original_order_id, order_number`,
                [trackingNumber]
            );

            if (deliveredRes.rows.length > 0) {
                const delOrder = deliveredRes.rows[0];
                const targetParentId = delOrder.parent_order_id || delOrder.original_order_id;
                if ((delOrder.is_replacement || delOrder.order_number?.endsWith('-REP')) && targetParentId) {
                    console.log(`[DTDC] Replacement shipment delivered for tracking ${trackingNumber}. Syncing parent order ${targetParentId} to Replaced.`);
                    await pool.query(
                        `UPDATE order_items 
                         SET status = 'Replaced' 
                         WHERE order_id = $1::uuid 
                           AND (status ILIKE '%replace%' OR status = 'Received at Homved')`,
                        [targetParentId]
                    );
                    await pool.query(
                        `UPDATE orders 
                         SET status = 'Replaced', 
                             logistics_status = 'Delivered',
                             delivered_at = COALESCE(delivered_at, NOW()),
                             updated_at = NOW() 
                         WHERE id = $1::uuid`,
                        [targetParentId]
                    );
                }
            }
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

/**
 * 4. Book Reverse Consignment / Reverse Pickup with DTDC (Softdata)
 * Customer Doorstep -> Homved Medicine Center
 */
exports.createReverseShipment = async (orderId, packageOptions = {}) => {
    // Fetch order details with pickup address
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

    // Idempotent: never book a second reverse pickup for the same order
    if (order.reverse_tracking_id) {
        console.log(`[DTDC] Reverse pickup already booked for ${order.order_number}: ${order.reverse_tracking_id}`);
        return { success: true, alreadyBooked: true, reverseTrackingNumber: order.reverse_tracking_id, order };
    }

    // Customer is origin for reverse pickup
    const pickupDetails = sanitizeDTDCAddress(order);

    if (!pickupDetails.pincode || pickupDetails.pincode.length !== 6) {
        throw new Error('Customer pickup pincode is missing or invalid for reverse shipment.');
    }

    const length = (packageOptions.length || 10).toString();
    const width = (packageOptions.width || 10).toString();
    const height = (packageOptions.height || 10).toString();
    const weight = (packageOptions.weight || 0.5).toString();
    // Declare only the value of the items actually coming back (not the whole order)
    const returningValue = (order.items || [])
        .filter(it => /^(Return|Replace)/.test(it.status || '') || it.status === 'Replacement Request Processing')
        .reduce((sum, it) => sum + (parseFloat(it.price) || 0) * (parseInt(it.quantity) || 1), 0);
    const reverseBase = returningValue > 0 ? returningValue : parseFloat(order.total || 0);
    const declaredValue = Math.round(reverseBase > 0 ? reverseBase : 500).toString();

    // Prepare reverse softdata payload
    const payload = {
        consignments: [
            {
                customer_code: DTDC_REVERSE_CUSTOMER_CODE,
                service_type_id: "B2C PRIORITY",
                load_type: "NON-DOCUMENT",
                consignment_type: "Reverse",
                description: "Homved Healthcare Return/Replacement",
                dimension_unit: "cm",
                length: length,
                width: width,
                height: height,
                weight_unit: "kg",
                weight: weight,
                declared_value: declaredValue,
                num_pieces: "1",
                origin_details: {
                    name: pickupDetails.name,
                    phone: pickupDetails.phone,
                    alternate_phone: "0000000000",
                    address_line_1: pickupDetails.address_line_1,
                    address_line_2: pickupDetails.address_line_2,
                    pincode: pickupDetails.pincode,
                    city: pickupDetails.city,
                    latitude: "",
                    longitude: "",
                    state: pickupDetails.state
                },
                destination_details: {
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
                customer_reference_number: `${order.order_number}-REV`,
                cod_collection_mode: "",
                cod_amount: "",
                commodity_id: "Medicine",
                eway_bill: "",
                is_risk_surcharge_applicable: "false",
                invoice_number: `RET-${order.order_number}`,
                invoice_date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
                reference_number: ""
            }
        ]
    };

    console.log(`[DTDC] Creating REVERSE shipment for Order ${order.order_number} (Customer Code: ${DTDC_REVERSE_CUSTOMER_CODE})...`);

    let consignment = null;
    let reverseTrackingNumber = null;
    let isForwardAccountFallback = false;
    let fallbackReason = '';

    try {
        const response = await fetchWithTimeout(`${DTDC_BASE_URL}/api/customer/integration/consignment/softdata`, {
            method: 'POST',
            headers: {
                'api-key': DTDC_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        }, DTDC_TIMEOUT_MS.booking, 'reverse booking');

        const responseData = await readJson(response, 'reverse booking');
        console.log('[DTDC] Reverse Softdata Response:', JSON.stringify(responseData, null, 2));

        const rawError = responseData.error?.message || responseData.message || responseData.data?.[0]?.message || '';

        if (isForwardCustomerError(rawError)) {
            console.warn(`[DTDC] Customer account ${DTDC_REVERSE_CUSTOMER_CODE} is forward-only (${rawError}). Attempting reverse pickup with consignment_type: 'Forward'...`);
            payload.consignments[0].consignment_type = "Forward";
            try {
                const retryResp = await fetchWithTimeout(`${DTDC_BASE_URL}/api/customer/integration/consignment/softdata`, {
                    method: 'POST',
                    headers: {
                        'api-key': DTDC_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                }, DTDC_TIMEOUT_MS.booking, 'reverse-as-forward booking');

                const retryData = await readJson(retryResp, 'reverse-as-forward booking');
                console.log('[DTDC] Reverse-as-Forward Response:', JSON.stringify(retryData, null, 2));

                if (retryData.status === 'OK' && retryData.data && retryData.data[0]?.success && retryData.data[0]?.reference_number) {
                    consignment = retryData.data[0];
                    reverseTrackingNumber = consignment.reference_number;
                    console.log(`[DTDC] Reverse pickup booked successfully with consignment_type Forward! AWB: ${reverseTrackingNumber}`);
                } else {
                    fallbackReason = retryData.data?.[0]?.message || retryData.message || rawError;
                }
            } catch (retryErr) {
                console.warn('[DTDC] Retry as Forward error:', retryErr.message);
                fallbackReason = retryErr.message;
            }
        } else if (responseData.status === 'OK' && responseData.data && responseData.data[0]?.success && responseData.data[0]?.reference_number) {
            consignment = responseData.data[0];
            reverseTrackingNumber = consignment.reference_number;
        } else {
            fallbackReason = rawError || 'DTDC rejected reverse booking';
        }
    } catch (apiErr) {
        console.warn('[DTDC] Reverse booking request failure:', apiErr.message);
        fallbackReason = apiErr.message;
    }

    // If reverse booking cannot be completed on DTDC (e.g. forward-only contract or courier failure):
    // DO NOT abort or block the return/replacement journey!
    // Generate an internal reverse tracking identifier so returns, replacements, QA inspection,
    // and refunds can be processed seamlessly.
    if (!reverseTrackingNumber) {
        isForwardAccountFallback = true;
        const cleanOrderNum = (order.order_number || orderId.toString()).replace(/^#/, '');
        reverseTrackingNumber = `REV-DTDC-${cleanOrderNum}`;
        console.warn(`[DTDC] Forward-only account contract. Assigned internal reverse tracking reference: ${reverseTrackingNumber} for Order ${cleanOrderNum}. Reason: ${fallbackReason}`);
    }

    // Update order in database with reverse tracking details
    const updateRes = await pool.query(
        `UPDATE orders 
         SET reverse_tracking_id = $1, 
             logistics_provider = 'DTDC', 
             logistics_status = 'Reverse Pickup Scheduled',
             updated_at = NOW()
         WHERE id = $2 
         RETURNING *`,
        [reverseTrackingNumber, orderId]
    );

    return {
        success: true,
        reverseTrackingNumber: reverseTrackingNumber,
        isForwardAccountFallback: isForwardAccountFallback,
        warning: isForwardAccountFallback ? `DTDC account is forward-only. Assigned internal reverse tracking reference: ${reverseTrackingNumber}. You can enter an external courier AWB if booked offline.` : undefined,
        customerReferenceNumber: consignment?.customer_reference_number || `${order.order_number}-REV`,
        order: updateRes.rows[0],
        dtdcResponse: consignment
    };
};
