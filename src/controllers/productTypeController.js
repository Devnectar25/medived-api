
const productTypeService = require('../services/productTypeService');

exports.getAllProductTypes = async (req, res) => {
    try {
        const types = await productTypeService.getAllProductTypes();
        res.json({ success: true, data: types });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

exports.createProductType = async (req, res) => {
    try {
        const type = await productTypeService.createProductType(req.body);
        res.status(201).json({ success: true, data: type });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

exports.updateProductType = async (req, res) => {
    try {
        const type = await productTypeService.updateProductType(req.params.id, req.body);
        if (!type) return res.status(404).json({ success: false, message: 'Product Type not found' });
        res.json({ success: true, data: type });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

exports.deleteProductType = async (req, res) => {
    try {
        const success = await productTypeService.deleteProductType(req.params.id);
        if (!success) return res.status(404).json({ success: false, message: 'Product Type not found' });
        res.json({ success: true, message: 'Product Type deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
