const healthTipService = require("../services/healthTipService");

exports.getAll = async (req, res) => {
    try {
        const { page, limit } = req.query;
        const tips = await healthTipService.getAllHealthTips(page, limit);
        res.json(tips);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getById = async (req, res) => {
    try {
        const tip = await healthTipService.getHealthTipById(req.params.id);
        if (tip) {
            res.json(tip);
        } else {
            res.status(404).json({ message: "Health tip not found" });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.create = async (req, res) => {
    try {
        const tip = await healthTipService.createHealthTip(req.body);
        res.status(201).json(tip);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const tip = await healthTipService.updateHealthTip(req.params.id, req.body);
        if (tip) {
            res.json(tip);
        } else {
            res.status(404).json({ message: "Health tip not found" });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.delete = async (req, res) => {
    try {
        const result = await healthTipService.deleteHealthTip(req.params.id);
        if (result) {
            res.json({ message: "Health tip deleted successfully" });
        } else {
            res.status(404).json({ message: "Health tip not found" });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getActive = async (req, res) => {
    try {
        const tips = await healthTipService.getActiveHealthTips();
        res.json(tips);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.setActive = async (req, res) => {
    try {
        const tip = await healthTipService.setActiveHealthTip(req.params.id);
        if (tip) {
            res.json({ message: "Health tip activated successfully", data: tip });
        } else {
            res.status(404).json({ message: "Health tip not found" });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.setInactive = async (req, res) => {
    try {
        const tip = await healthTipService.setInactiveHealthTip(req.params.id);
        if (tip) {
            res.json({ message: "Health tip deactivated successfully", data: tip });
        } else {
            res.status(404).json({ message: "Health tip not found" });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Multer configuration for image uploads
const storageService = require("../services/storageService");
const multer = require("multer");

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

exports.uploadHealthTipImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const publicUrl = await storageService.uploadImage(req.file, 'health_tips');
        res.json({ success: true, url: publicUrl, message: "Image uploaded successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteHealthTipImage = async (req, res) => {
    try {
        const { imageUrl } = req.body;
        if (!imageUrl) {
            return res.status(400).json({ success: false, message: "Image URL is required" });
        }

        await storageService.deleteImage(imageUrl);
        res.json({ success: true, message: "Image deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
