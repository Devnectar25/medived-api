const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.get('/', protect, authorize('admin', 'super_admin'), userController.getUsers);
router.put('/profile', protect, userController.updateProfile);

module.exports = router;
