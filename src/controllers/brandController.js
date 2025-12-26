const brandService = require('../services/brandService');
const storageService = require('../services/storageService');
const multer = require('multer');

// Multer configuration for memory storage
const storage = multer.memoryStorage();
exports.uploadMiddleware = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and SVG are allowed.'));
        }
    }
}).single('image');

exports.getBrands = async (req, res) => {
    try {
        const { page, limit } = req.query;
        const data = await brandService.getAllBrands(page, limit);
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in getBrands:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getActiveBrands = async (req, res) => {
    try {
        const data = await brandService.getActiveBrands();
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in getActiveBrands:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getBrandById = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const data = await brandService.getBrandById(id);
        if (!data) {
            return res.status(404).json({ success: false, message: "Brand not found" });
        }
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error in getBrandById:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.createBrand = async (req, res) => {
    try {
        const inputData = req.body;
        // Default active to true if not provided
        inputData.active = inputData.active === undefined ? true : inputData.active;

        // Ensure name is provided
        if (!inputData.name) {
            return res.status(400).json({ success: false, message: "Brand name is required" });
        }

        const data = await brandService.createBrand(inputData);
        res.status(201).json({ success: true, data, message: "Brand created successfully" });
    } catch (error) {
        console.error("Error in createBrand:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateBrand = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const inputData = req.body;

        // Default active checks are handled by frontend usually, but good to have fallback? 
        // Logic says update what's sent. Service handles partial updates by updating full row with sent data.
        // We assume req.body contains the full object or we merge it. 
        // For simplicity and alignment with requirement: updates same fields.

        const data = await brandService.updateBrand(id, inputData);

        if (!data) {
            return res.status(404).json({ success: false, message: "Brand not found" });
        }

        res.json({ success: true, data, message: "Brand updated successfully" });
    } catch (error) {
        console.error("Error in updateBrand:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.deleteBrand = async (req, res) => {
    try {
        const id = req.params.id;
        // Ideally should delete image from storage too if exists, but strictly requested just generic delete API update.
        // Bonus: fetch brand, get logo url, delete from storage, then delete from DB.
        const brand = await brandService.getBrandById(id);
        if (brand && brand.brand_logo) {
            await storageService.deleteImage(brand.brand_logo);
        }

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

exports.uploadBrandImage = async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ success: false, message: "No file uploaded" });
            return;
        }

        const publicUrl = await storageService.uploadImage(req.file, 'brand');
        res.json({ success: true, url: publicUrl, message: "Image uploaded successfully" });
    } catch (error) {
        console.error("Error in uploadBrandImage:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.deleteBrandImage = async (req, res) => {
    try {
        const { imageUrl } = req.body;
        if (!imageUrl) {
            return res.status(400).json({ success: false, message: "Image URL is required" });
        }

        await storageService.deleteImage(imageUrl);
        res.json({ success: true, message: "Image deleted successfully" });
    } catch (error) {
        console.error("Error in deleteBrandImage:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};
