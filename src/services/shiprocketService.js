/**
 * Shiprocket Logistics Service (MOCK IMPLEMENTATION)
 * Handles automated forward and reverse logistics.
 */

const axios = require('axios');

/**
 * Creates a reverse pickup request in Shiprocket.
 * As per HOMVED-RR-05: Automate reverse pickups for approved returns.
 */
exports.createReversePickup = async (order, itemsToReturn) => {
    const isMock = process.env.SHIPROCKET_MOCK !== 'false'; // Default to mock

    const payload = {
        order_id: order.order_number,
        order_date: order.createdate,
        pickup_customer_name: `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`,
        pickup_last_name: order.shippingAddress.lastName,
        pickup_address: order.shippingAddress.address,
        pickup_city: order.shippingAddress.city,
        pickup_state: order.shippingAddress.state,
        pickup_country: order.shippingAddress.country,
        pickup_pincode: order.shippingAddress.pincode,
        pickup_email: order.shippingAddress.email,
        pickup_phone: order.shippingAddress.phone,
        order_items: itemsToReturn.map(item => ({
            name: item.name,
            sku: item.product_id,
            units: item.quantity,
            selling_price: item.price
        })),
        payment_method: "Prepaid",
        total_discount: 0,
        sub_total: itemsToReturn.reduce((sum, i) => sum + (i.price * i.quantity), 0),
        length: 10,
        breadth: 10,
        height: 10,
        weight: 0.5
    };

    if (isMock) {
        console.log('\n================================');
        console.log('🚚 SHIPROCKET REVERSE PICKUP (MOCK)');
        console.log('Order:', order.order_number);
        console.log('Pickup From:', payload.pickup_customer_name);
        console.log('Items:', payload.order_items.length);
        console.log('Payload:', JSON.stringify(payload, null, 2));
        console.log('================================\n');
        
        return { 
            success: true, 
            shipment_id: `SR-MOCK-REV-${Date.now()}`,
            awb_code: `REV${Math.floor(100000000 + Math.random() * 900000000)}`
        };
    }

    // Real API implementation would go here (requires Shiprocket Auth Token)
    // const token = await getShiprocketAuthToken();
    // const response = await axios.post('https://apiv2.shiprocket.in/v1/external/orders/create/return', payload, { headers: { Authorization: `Bearer ${token}` } });
    // return response.data;
    
    throw new Error('Real Shiprocket integration not fully configured.');
};
