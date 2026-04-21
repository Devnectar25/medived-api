const pool = require('./src/config/db');

async function seedCampaigns() {
  try {
    const campaigns = [
      // 1. Diwali Offer Campaign related to DEWALIALL20
      {
        title: "Diwali Grand Sale - 20% OFF",
        festival_message: "🧨 Happy Diwali from HOMVED! 🪔\n\nCelebrate the festival of lights with our exclusive site-wide discount.",
        offer_details: "Use coupon code *DEWALIALL20* at checkout to get an instant 20% discount on all our Ayurvedic products. Stock up on health & wellness today!",
        image_url: "https://images.unsplash.com/photo-1603812838385-c54e7d4d422a?auto=format&fit=crop&q=80&w=800",
        discount_type: "percentage",
        discount_value: 20
      },
      // 2. BOGO Offer Campaign related to BOGOFREE
      {
        title: "Buy 1 Get 1 Free - Premium Offer",
        festival_message: "🌟 Exclusive BOGO Deal! 🌟\n\nFor a limited time only, buy one and get another absolutely FREE on selected premium products.",
        offer_details: "Just use code *BOGOFREE* during checkout. It's the perfect time to double up your Ayurvedic supplements without paying extra!",
        image_url: "https://images.unsplash.com/photo-1542010589005-d1eabd39185c?auto=format&fit=crop&q=80&w=800",
        discount_type: "bogo",
        discount_value: 0
      },
      // 3. Summer Sale Campaign related to SUMMER25
      {
        title: "Summer Wellness Sale - 25% OFF",
        festival_message: "☀️ Beat the Heat with HOMVED! ☀️\n\nStay healthy and hydrated this summer with our special category discount.",
        offer_details: "Apply coupon *SUMMER25* to instantly take 25% off your order. Don't miss out on these summer savings!",
        image_url: "https://images.unsplash.com/photo-1519368358672-25b03afee3bf?auto=format&fit=crop&q=80&w=800",
        discount_type: "percentage",
        discount_value: 25
      },
      // 4. Dabur Brand specific Campaign related to BRANDDABUR500
      {
        title: "Dabur Special - Flat ₹500 OFF",
        festival_message: "🌿 Big Savings on Dabur Products! 🌿\n\nWe've partnered with Dabur to bring you incredible savings on their entire range.",
        offer_details: "Enjoy a flat ₹500 discount on your order. Use code *BRANDDABUR500* at checkout. Hurry, offer valid while stocks last!",
        image_url: "https://images.unsplash.com/photo-1611078489935-0cb964de46d6?auto=format&fit=crop&q=80&w=800",
        discount_type: "fixed",
        discount_value: 500
      },
      // 5. Special Random Campaign (No Coupon)
      {
        title: "New Year Health Resolution",
        festival_message: "✨ New Year, Healthier You! ✨\n\nStart your year right with HOMVED's new line of immunity boosters.",
        offer_details: "Explore our new collection of pure organic juices and raw honey. Click the link below to see our featured products for the new year.",
        image_url: "https://images.unsplash.com/photo-1512428559087-560fa5ceab42?auto=format&fit=crop&q=80&w=800",
        discount_type: null,
        discount_value: null
      }
    ];

    for (let c of campaigns) {
      await pool.query(
        `INSERT INTO whatsapp_campaigns (title, festival_message, offer_details, image_url, discount_type, discount_value) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [c.title, c.festival_message, c.offer_details, c.image_url, c.discount_type, c.discount_value || 0]
      );
    }
    console.log("Successfully seeded 5 campaigns!");

  } catch (error) {
    console.error("Error seeding campaigns:", error);
  } finally {
    await pool.end();
  }
}

seedCampaigns();
