const healthTipService = require("../services/healthTipService");

exports.getAll = async (req, res) => {
    try {
        const tips = await healthTipService.getAllHealthTips();
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
