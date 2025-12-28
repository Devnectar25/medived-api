const express = require("express");
const router = express.Router();
const healthTipController = require("../controllers/healthTipController");

router.get("/", healthTipController.getAll);
router.get("/:id", healthTipController.getById);
router.post("/", healthTipController.create);
router.put("/:id", healthTipController.update);
router.delete("/:id", healthTipController.delete);

module.exports = router;
