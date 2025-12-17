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

exports.createProduct = async (req, res) => {
    try {
        const product = req.body;
        const data = await productService.createProduct(product);
        res.status(201).json({ success: true, data });
    } catch (error) {
        console.error("Error in createProduct:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateProduct = async (req, res) => {
    try {
        const id = req.params.id;
        const product = req.body;
        const data = await productService.updateProduct(id, product);

        if (!data) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in updateProduct:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.deleteProduct = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await productService.deleteProduct(id);

        if (!data) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        res.json({ success: true, data, message: "Product deleted successfully" });
    } catch (error) {
        console.error("Error in deleteProduct:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.setActiveProduct = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await productService.setActiveProduct(id);

        if (!data) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        res.json({ success: true, data, message: "Product activated successfully" });
    } catch (error) {
        console.error("Error in setActiveProduct:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.setInactiveProduct = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await productService.setInactiveProduct(id);

        if (!data) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        res.json({ success: true, data, message: "Product deactivated successfully" });
    } catch (error) {
        console.error("Error in setInactiveProduct:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};
