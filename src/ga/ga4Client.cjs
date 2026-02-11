// src/ga/ga4Client.cjs

const { BetaAnalyticsDataClient } = require("@google-analytics/data");
const path = require("path");

// Load env vars (make sure dotenv is already loaded in server.js/app.js)
const propertyId = process.env.GA4_PROPERTY_ID;
const keyFilePath = process.env.GA4_KEY_FILE;

if (!propertyId || !keyFilePath) {
  throw new Error(
    "GA4_PROPERTY_ID or GA4_KEY_FILE is missing in environment variables"
  );
}

// Create GA4 Data API client
const ga4Client = new BetaAnalyticsDataClient({
  keyFilename: path.resolve(keyFilePath),
});

module.exports = {
  ga4Client,
  propertyId,
};
