const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const bankAccountService = require('../services/bankAccountService');

// All routes operate on the logged-in user's own saved refund bank accounts
router.use(protect);

const handle = (fn) => async (req, res) => {
    try {
        const data = await fn(req);
        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('[BankAccounts] Error:', error.message);
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

router.get('/', handle(req => bankAccountService.listAccounts(req.user.id)));
router.post('/', handle(req => bankAccountService.saveAccount(req.user.id, req.body, { makeDefault: !!req.body?.makeDefault })));
router.patch('/:id/default', handle(req => bankAccountService.setDefault(req.user.id, req.params.id)));
router.delete('/:id', handle(req => bankAccountService.deleteAccount(req.user.id, req.params.id)));

module.exports = router;
