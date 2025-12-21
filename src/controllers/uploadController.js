const storageService = require('../services/storageService');
const multer = require('multer');

// Configure Multer for memory storage
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

exports.uploadImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const folderName = req.body.folderName || 'common'; // Default to 'common' if not provided
        const publicUrl = await storageService.uploadImage(req.file, folderName);

        res.json({
            success: true,
            url: publicUrl,
            message: "Image uploaded successfully"
        });
    } catch (error) {
        console.error("Error in uploadImage:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.deleteImage = async (req, res) => {
    try {
        const { imageUrl } = req.body;
        if (!imageUrl) {
            return res.status(400).json({ success: false, message: "Image URL is required" });
        }

        await storageService.deleteImage(imageUrl);
        res.json({ success: true, message: "Image deleted successfully" });
    } catch (error) {
        console.error("Error in deleteImage:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};
