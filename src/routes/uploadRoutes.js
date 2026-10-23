const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');

router.post('/upload-image', (req, res, next) => {
    uploadController.uploadMiddleware(req, res, (err) => {
        if (err) {
            console.error("Multer Error during image upload:", err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    success: false,
                    message: "Image size should be less than 500KB. Please upload a smaller file."
                });
            }
            return res.status(400).json({ 
                success: false, 
                message: err.message || "Failed to upload image",
                error: err.message 
            });
        }
        next();
    });
}, uploadController.uploadImage);

router.post('/upload-video', (req, res, next) => {
    uploadController.uploadVideoMiddleware(req, res, (err) => {
        if (err) {
            console.error("Multer Error during video upload:", err);
            return res.status(400).json({ 
                success: false, 
                message: "Upload failed at the middleware level",
                error: err.message 
            });
        }
        next();
    });
}, uploadController.uploadVideo);

router.delete('/delete-image', uploadController.deleteImage);
router.delete('/delete-video', uploadController.deleteImage); // Reusing deleteImage as it's generic
router.delete('/delete-folder', uploadController.deleteFolder);

module.exports = router;
