const express = require('express');
const router = express.Router();
const faqController = require('../controllers/faqController');

router.get('/', faqController.getAllFAQs);
// router.post('/', faqController.createFAQ); // Protected route for admin later

module.exports = router;
