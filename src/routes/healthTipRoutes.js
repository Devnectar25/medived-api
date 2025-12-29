const express = require("express");
const router = express.Router();
const healthTipController = require("../controllers/healthTipController");

router.get("/", healthTipController.getAll);
router.get("/active", healthTipController.getActive);
router.get("/:id", healthTipController.getById);
router.post("/", healthTipController.create);
router.put("/:id", healthTipController.update);
router.delete("/:id", healthTipController.delete);
router.put("/:id/activate", healthTipController.setActive);
router.put("/:id/deactivate", healthTipController.setInactive);
router.post("/upload-image", healthTipController.uploadMiddleware, healthTipController.uploadHealthTipImage);
router.delete("/delete-image", healthTipController.deleteHealthTipImage);

module.exports = router;
