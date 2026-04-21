/**
 * WhatsApp Service (MOCK IMPLEMENTATION)
 * This is currently a mock service that logs to the console.
 * To use a real provider (like Twilio):
 * 1. npm install twilio
 * 2. Set WHATSAPP_PROVIDER=twilio in .env
 * 3. Update the SEND branch below with Twilio client logic.
 */

const sendCampaignMessage = async (campaign, user, productData) => {
    const provider = process.env.WHATSAPP_PROVIDER || 'mock';

    // Construct the dynamic message
    let messageText = campaign.festival_message || "";
    if (campaign.offer_details) {
        messageText += `\n\n${campaign.offer_details}`;
    }
    if (productData && productData.id) {
        // Construct tracked URL
        const link = `${process.env.CLIENT_URL || 'http://localhost:5173'}/products/${productData.id}?campaign_id=${campaign.id}`;
        messageText += `\n\nCheck out the offer here: ${link}`;
    }

    if (provider === 'twilio') {
        // Twilio Implementation Placeholder
        // const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        // await client.messages.create({...});
        console.log(`[TWILIO] Would send to ${user.phone}`);
    } else {
        // MOCK IMPLEMENTATION
        console.log(`\n================================`);
        console.log(`💬 MOCK WHATSAPP MESSAGE SENT`);
        console.log(`To: ${user.phone} (${user.id})`);
        if (campaign.image_url) {
            console.log(`Image attached: ${campaign.image_url}`);
        }
        console.log(`Message:\n${messageText}`);
        console.log(`================================\n`);
    }

    return { success: true, messageId: `mock-${Date.now()}` };
};

module.exports = {
    sendCampaignMessage
};
