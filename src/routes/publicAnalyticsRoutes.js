const express = require("express");
const router = express.Router();
const { trackEvent } = require("../controllers/analyticsController");

// POST /api/analytics/track
router.post("/track", trackEvent);

module.exports = router;
