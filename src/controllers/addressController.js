const addressService = require('../services/addressService');

exports.getUserAddresses = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId || userId === 'undefined') {
            return res.status(400).json({ success: false, message: 'User ID is required and cannot be undefined' });
        }
        const addresses = await addressService.getAddressesByUserId(userId);
        res.status(200).json({ success: true, data: addresses });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.createAddress = async (req, res) => {
    try {
        const address = await addressService.addAddress(req.body);
        res.status(201).json({ success: true, data: address });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateAddress = async (req, res) => {
    try {
        const { id } = req.params;
        const address = await addressService.updateAddress(id, req.body);
        res.status(200).json({ success: true, data: address });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteAddress = async (req, res) => {
    try {
        const { id } = req.params;
        await addressService.deleteAddress(id);
        res.status(200).json({ success: true, message: 'Address deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
