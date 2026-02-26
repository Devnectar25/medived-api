// src/ga/ga4Client.cjs

const { BetaAnalyticsDataClient } = require("@google-analytics/data");
const path = require("path");

// Load env vars (make sure dotenv is already loaded in server.js/app.js)
const propertyId = process.env.GA4_PROPERTY_ID;
const keyFilePath = process.env.GA4_KEY_FILE;

let ga4Client = null;

if (propertyId && keyFilePath) {
  try {
    // Create GA4 Data API client
    ga4Client = new BetaAnalyticsDataClient({
      keyFilename: path.resolve(keyFilePath),
    });
    console.log('✅ GA4 client initialized');
  } catch (err) {
    console.error('❌ Failed to initialize GA4 client:', err.message);
  }
} else {
  console.warn("⚠️ GA4_PROPERTY_ID or GA4_KEY_FILE is missing - GA4 features will be disabled");
}

module.exports = {
  ga4Client,
  propertyId,
};
