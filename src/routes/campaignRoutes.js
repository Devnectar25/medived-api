const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Public route for tracking/fetching campaign by ID
router.get('/public/:id', campaignController.getPublicCampaign);

// Admin routes
router.get('/', protect, authorize('admin', 'super_admin'), campaignController.getCampaigns);
router.post('/', protect, authorize('admin', 'super_admin'), campaignController.createCampaign);
router.put('/:id', protect, authorize('admin', 'super_admin'), campaignController.updateCampaign);
router.patch('/:id/status', protect, authorize('admin', 'super_admin'), campaignController.toggleCampaignStatus);
router.delete('/:id', protect, authorize('admin', 'super_admin'), campaignController.deleteCampaign);
router.post('/:id/send', protect, authorize('admin', 'super_admin'), campaignController.sendCampaign);

module.exports = router;
