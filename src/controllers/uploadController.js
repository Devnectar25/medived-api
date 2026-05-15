const storageService = require('../services/storageService');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configure Multer for memory storage (for smaller files like images)
const memoryStorage = multer.memoryStorage();

// Configure Multer for disk storage (for larger files like videos)
const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(os.tmpdir(), 'homved-uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Clean filename to avoid issues with special characters
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        cb(null, `${Date.now()}-${cleanName}`);
    }
});

exports.uploadMiddleware = multer({
    storage: memoryStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for images
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, WebP, SVG, and PDF are allowed.'));
        }
    }
}).single('image');

// Video upload middleware using disk storage for large files
exports.uploadVideoMiddleware = multer({
    storage: diskStorage,
    limits: { fileSize: 250 * 1024 * 1024 }, // Increased to 250MB to be safe
    fileFilter: (req, file, cb) => {
        // Now that bucket is fixed, we can be lenient but specific
        if (file.mimetype.startsWith('video/') || 
            ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'].includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Please upload a supported video format.'));
        }
    }
}).single('video');

exports.uploadImage = async (req, res) => {
    try {
        console.log(`[UPLOAD] Image request received: ${req.file?.originalname}, size: ${req.file?.size} bytes`);
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const folderName = req.body.folderName || 'common'; 
        const publicUrl = await storageService.uploadImage(req.file, folderName);

        console.log(`[UPLOAD] Image successful: ${publicUrl}`);
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

exports.uploadVideo = async (req, res) => {
    let tempFilePath = null;
    try {
        console.log(`[UPLOAD] Video headers received:`, {
            contentType: req.headers['content-type'],
            contentLength: req.headers['content-length']
        });
        
        if (!req.file) {
            console.error("[UPLOAD] No file in request. Check field name (should be 'video')");
            console.log("[UPLOAD] Body received:", req.body);
            return res.status(400).json({ success: false, message: "No video file uploaded" });
        }

        tempFilePath = req.file.path;
        console.log(`[UPLOAD] Video request received: ${req.file.originalname}, size: ${req.file.size} bytes`);
        
        const folderName = req.body.folderName || 'videos';
        console.log(`[UPLOAD] Starting storage upload from disk: ${tempFilePath} to folder: ${folderName}`);
        
        const publicUrl = await storageService.uploadImage(req.file, folderName);

        console.log(`[UPLOAD] Video successful: ${publicUrl}`);
        
        // Clean up temp file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch (e) { console.error("Cleanup error:", e); }
        }

        res.json({
            success: true,
            url: publicUrl,
            message: "Video uploaded successfully"
        });
    } catch (error) {
        console.error("Error in uploadVideo:", error);
        
        // Clean up temp file on error
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch (e) { console.error("Cleanup error on failure:", e); }
        }

        res.status(500).json({ 
            success: false, 
            message: "Internal Server Error during video upload",
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
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

exports.deleteFolder = async (req, res) => {
    try {
        const { folderPath } = req.body;
        if (!folderPath) {
            return res.status(400).json({ success: false, message: "Folder path is required" });
        }

        await storageService.deleteFolder(folderPath);
        res.json({ success: true, message: "Folder deleted successfully" });
    } catch (error) {
        console.error("Error in deleteFolder:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};
