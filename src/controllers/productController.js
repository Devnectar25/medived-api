const productService = require('../services/productService');

exports.getProducts = async (req, res) => {
    try {
        const data = await productService.getAllProducts();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

exports.getProduct = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await productService.getProductById(id);

        if (!data) {
            return res.status(404).json({ success: false, message: "Not Found" });
        }

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};
