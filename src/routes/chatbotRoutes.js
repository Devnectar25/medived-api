const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbotController');

// NLP query processing (NEW)
router.post('/query', chatbotController.processQuery);

// Submit user feedback
router.post('/feedback', chatbotController.submitFeedback);

// Get query suggestions (autocomplete)
router.get('/suggestions', chatbotController.getSuggestions);

// Log product clicks (NEW)
router.post('/log-click', chatbotController.logProductClick);

module.exports = router;
