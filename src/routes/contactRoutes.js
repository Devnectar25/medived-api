const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');

const { protect, authorize } = require('../middlewares/authMiddleware');

router.post('/submit', contactController.submitContactForm);
router.get('/leads', protect, authorize('admin'), contactController.getAllLeads);

module.exports = router;
