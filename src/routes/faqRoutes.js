const express = require('express');
const router = express.Router();
const { cachePublic, invalidateOnWrite } = require('../middlewares/publicCache');

const LIST_TTL = 30 * 1000;

router.use(invalidateOnWrite);
const faqController = require('../controllers/faqController');

router.get('/', cachePublic(LIST_TTL), faqController.getAllFAQs);
// router.post('/', faqController.createFAQ); // Protected route for admin later

module.exports = router;
