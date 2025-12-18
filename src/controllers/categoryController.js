const categoryService = require('../services/categoryService');

exports.getCategories = async (req, res) => {
    try {
        const data = await categoryService.getAllCategories();
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in getCategories:", error); // Log the actual error
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getActiveCategories = async (req, res) => {
    try {
        const data = await categoryService.getActiveCategories();
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in getActiveCategories:", error); // Log the actual error
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.createCategory = async (req, res) => {
    try {
        const inputData = req.body;
        inputData.active = inputData.active === undefined ? true : inputData.active;
        const data = await categoryService.createCategory(inputData);
        res.status(201).json({ success: true, data });
    } catch (error) {
        console.error("Error in createCategory:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateCategory = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const requestBody = req.body;
        // todo set default active true if not provided
        requestBody.active = requestBody.active === undefined ? true : requestBody.active;
        const data = await categoryService.updateCategory(id, requestBody);

        if (!data) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in updateCategory:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await categoryService.deleteCategory(id);

        if (!data) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        res.json({ success: true, data, message: "Category deleted successfully" });
    } catch (error) {
        console.error("Error in deleteCategory:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.setActiveCategory = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await categoryService.setActiveCategory(id);

        if (!data) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        res.json({ success: true, data, message: "Category activated successfully" });
    } catch (error) {
        console.error("Error in setActiveCategory:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.setInactiveCategory = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await categoryService.setInactiveCategory(id);

        if (!data) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        res.json({ success: true, data, message: "Category deactivated successfully" });
    } catch (error) {
        console.error("Error in setInactiveCategory:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};
