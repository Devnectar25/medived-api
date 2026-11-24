const express = require("express");
const router = express.Router();
const { cachePublic, invalidateOnWrite } = require('../middlewares/publicCache');

const LIST_TTL = 30 * 1000;

router.use(invalidateOnWrite);
const healthTipController = require("../controllers/healthTipController");

router.get("/", cachePublic(LIST_TTL), healthTipController.getAll);
router.get("/active", cachePublic(LIST_TTL), healthTipController.getActive);
router.get("/home", cachePublic(LIST_TTL), healthTipController.getHome);
router.get("/:id", cachePublic(LIST_TTL), healthTipController.getById);
router.post("/", healthTipController.create);
router.put("/:id", healthTipController.update);
router.delete("/:id", healthTipController.delete);
router.put("/:id/activate", healthTipController.setActive);
router.put("/:id/deactivate", healthTipController.setInactive);
router.put("/:id/show-on-home", healthTipController.setShowOnHome);
router.post("/upload-image", (req, res, next) => {
    healthTipController.uploadMiddleware(req, res, (err) => {
        if (err) {
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
}, healthTipController.uploadHealthTipImage);
router.delete("/delete-image", healthTipController.deleteHealthTipImage);

module.exports = router;
