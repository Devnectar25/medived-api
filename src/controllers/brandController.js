const brandService = require('../services/brandService');

exports.getBrands = async (req, res) => {
    try {
        const data = await brandService.getAllBrands();
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in getBrands:", error); // Log the actual error
        res.status(500).json({ success: false, error: error.message });
    }
};
