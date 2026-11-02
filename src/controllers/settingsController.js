const settingsService = require('../services/settingsService');

exports.getSettings = async (req, res) => {
    try {
        const settings = await settingsService.getSettings();
        res.status(200).json({ success: true, data: settings });
    } catch (error) {
        console.error('Error in getSettings controller:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateSettings = async (req, res) => {
    try {
        const newConfig = req.body;
        if (!newConfig || typeof newConfig !== 'object') {
            return res.status(400).json({ success: false, message: 'Invalid configuration payload' });
        }
        const updated = await settingsService.updateSettings(newConfig);
        res.status(200).json({
            success: true,
            message: 'Settings updated successfully',
            data: updated
        });
    } catch (error) {
        console.error('Error in updateSettings controller:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

