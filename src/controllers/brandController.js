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

exports.getActiveBrands = async (req, res) => {
    try {
        const data = await brandService.getActiveBrands();
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in getActiveBrands:", error); // Log the actual error
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.createBrand = async (req, res) => {
    try {
        const inputData = req.body;
        inputData.active = inputData.active === undefined ? true : inputData.active;
        const data = await brandService.createBrand(inputData);
        res.status(201).json({ success: true, data });
    } catch (error) {
        console.error("Error in createBrand:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateBrand = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const requestBody = req.body;
        // todo set default active true if not provided
        requestBody.active = requestBody.active === undefined ? true : requestBody.active;
        const data = await brandService.updateBrand(id, requestBody);

        if (!data) {
            return res.status(404).json({ success: false, message: "Brand not found" });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in updateBrand:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.deleteBrand = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await brandService.deleteBrand(id);

        if (!data) {
            return res.status(404).json({ success: false, message: "Brand not found" });
        }

        res.json({ success: true, data, message: "Brand deleted successfully" });
    } catch (error) {
        console.error("Error in deleteBrand:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.setActiveBrand = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await brandService.setActiveBrand(id);

        if (!data) {
            return res.status(404).json({ success: false, message: "Brand not found" });
        }

        res.json({ success: true, data, message: "Brand activated successfully" });
    } catch (error) {
        console.error("Error in setActiveBrand:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.setInactiveBrand = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await brandService.setInactiveBrand(id);

        if (!data) {
            return res.status(404).json({ success: false, message: "Brand not found" });
        }

        res.json({ success: true, data, message: "Brand deactivated successfully" });
    } catch (error) {
        console.error("Error in setInactiveBrand:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};
