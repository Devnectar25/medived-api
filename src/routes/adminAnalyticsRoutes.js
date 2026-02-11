const express = require("express");
const router = express.Router();

const {
  getAdminAnalyticsSummary,
  getTopActiveUsers,
  getTopProducts,
  getTopCategories,
  getAnalyticsDrilldown
} = require("../controllers/analyticsController");

// GET /api/admin/analytics/summary
router.get("/summary", getAdminAnalyticsSummary);

// GET /api/admin/analytics/top-users
router.get("/top-users", getTopActiveUsers);

// GET /api/admin/analytics/top-products
router.get("/top-products", getTopProducts);

// GET /api/admin/analytics/top-categories
router.get("/top-categories", getTopCategories);

// GET /api/admin/analytics/drilldown
router.get("/drilldown", getAnalyticsDrilldown);

module.exports = router;
