const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// GET /api/settings - Public or authenticated so storefront & admin can read
router.get('/', settingsController.getSettings);

// PUT /api/settings - Admin only to update settings
router.put('/', protect, settingsController.updateSettings);
router.post('/', protect, settingsController.updateSettings);

module.exports = router;

