// src/ga/ga4Client.cjs

const { BetaAnalyticsDataClient } = require("@google-analytics/data");
const path = require("path");
const fs = require("fs");

const propertyId = process.env.GA4_PROPERTY_ID;
const keyFilePath = process.env.GA4_KEY_FILE;

let ga4Client = null;

if (propertyId && keyFilePath) {
  const resolvedPath = path.resolve(process.cwd(), keyFilePath);
  if (fs.existsSync(resolvedPath)) {
    try {
      ga4Client = new BetaAnalyticsDataClient({
        keyFilename: resolvedPath,
      });
      console.log("✅ GA4 Client initialized successfully");
    } catch (err) {
      console.error("❌ Failed to initialize GA4 Client:", err.message);
    }
  } else {
    console.warn(`⚠️ GA4 Key file not found at ${resolvedPath}. GA4 features will be disabled.`);
  }
} else {
  console.log("ℹ️ GA4 configuration missing. GA4 features are disabled.");
}

module.exports = {
  ga4Client,
  propertyId,
};
