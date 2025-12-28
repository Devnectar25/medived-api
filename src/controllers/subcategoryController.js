const subcategoryService = require('../services/subcategoryService');

exports.getSubcategories = async (req, res) => {
    try {
        const { page, limit, category_id } = req.query;
        let data;
        if (category_id) {
            data = await subcategoryService.getSubcategoriesBycategory_id(parseInt(category_id));
        } else {
            data = await subcategoryService.getAllSubcategories(page, limit);
        }
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in getSubcategories:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getSubcategoryById = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const data = await subcategoryService.getSubcategoryById(id);
        if (!data) {
            return res.status(404).json({ success: false, message: "Subcategory not found" });
        }
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in getSubcategoryById:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getActiveSubcategories = async (req, res) => {
    try {
        const data = await subcategoryService.getActiveSubcategories();
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in getActiveSubcategories:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.createSubcategory = async (req, res) => {
    try {
        const data = await subcategoryService.createSubcategory(req.body);
        res.status(201).json({ success: true, data, message: "Subcategory created successfully" });
    } catch (error) {
        console.error("Error in createSubcategory:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateSubcategory = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await subcategoryService.updateSubcategory(id, req.body);
        if (!data) return res.status(404).json({ success: false, message: "Subcategory not found" });
        res.json({ success: true, data, message: "Subcategory updated successfully" });
    } catch (error) {
        console.error("Error in updateSubcategory:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.deleteSubcategory = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await subcategoryService.deleteSubcategory(id);
        if (!data) return res.status(404).json({ success: false, message: "Subcategory not found" });
        res.json({ success: true, message: "Subcategory deleted successfully" });
    } catch (error) {
        console.error("Error in deleteSubcategory:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.setActiveSubcategory = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await subcategoryService.setActiveSubcategory(id);
        if (!data) return res.status(404).json({ success: false, message: "Subcategory not found" });
        res.json({ success: true, data, message: "Subcategory activated successfully" });
    } catch (error) {
        console.error("Error in setActiveSubcategory:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.setInactiveSubcategory = async (req, res) => {
    try {
        const id = req.params.id;
        const data = await subcategoryService.setInactiveSubcategory(id);
        if (!data) return res.status(404).json({ success: false, message: "Subcategory not found" });
        res.json({ success: true, data, message: "Subcategory deactivated successfully" });
    } catch (error) {
        console.error("Error in setInactiveSubcategory:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};
