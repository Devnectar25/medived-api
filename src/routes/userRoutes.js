const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.get('/', protect, authorize('admin', 'super_admin'), userController.getUsers);
router.get('/profile', protect, userController.getProfile);
router.put('/profile', protect, userController.updateProfile);
router.delete('/profile', protect, userController.deleteAccount);
router.delete('/account', protect, userController.deleteAccount);

module.exports = router;
