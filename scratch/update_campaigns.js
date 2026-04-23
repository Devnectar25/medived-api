const pool = require('../src/config/db');

async function updateCampaigns() {
    const updates = [
        {
            id: 'dfa71799-8be7-463d-82d2-8f6a91c12361',
            festival_message: '✨ New Year, Healthier You! ✨',
            offer_details: "Start your year right with HOMVED's new line of immunity boosters. Explore our new collection of pure organic juices and raw honey below."
        },
        {
            id: '21f89628-8f3e-4d82-9fb6-64e11370662b',
            festival_message: '🌿 Big Savings on Dabur Products! 🌿',
            offer_details: "Elevate your wellness with Dabur's trusted essentials. Use code *BRANDDABUR500* at checkout for a flat ₹500 discount on your order."
        },
        {
            id: '85cd1ad4-7a9f-4ca9-ad60-5cb026ee3ba8',
            festival_message: '☀️ Beat the Heat with HOMVED! ☀️',
            offer_details: "Stay healthy and hydrated this summer. Apply coupon *SUMMER25* at checkout to enjoy 25% OFF your entire summer wellness order!"
        }
    ];

    try {
        for (let update of updates) {
            await pool.query(
                'UPDATE whatsapp_campaigns SET festival_message = $1, offer_details = $2 WHERE id = $3',
                [update.festival_message, update.offer_details, update.id]
            );
            console.log(`Updated campaign: ${update.id}`);
        }
    } catch (e) {
        console.error('Update failed:', e);
    } finally {
        process.exit();
    }
}

updateCampaigns();
