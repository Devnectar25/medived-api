const subAdminService = require('../services/subAdminService');

exports.getSubAdmins = async (req, res) => {
    try {
        const admins = await subAdminService.getSubAdmins();
        res.json({ success: true, data: admins });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createSubAdmin = async (req, res) => {
    try {
        const admin = await subAdminService.createSubAdmin(req.body);
        res.status(201).json({ success: true, data: admin });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.updateSubAdmin = async (req, res) => {
    try {
        const admin = await subAdminService.updateSubAdmin(req.params.id, req.body);
        res.json({ success: true, data: admin });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteSubAdmin = async (req, res) => {
    try {
        await subAdminService.deleteSubAdmin(req.params.id);
        res.json({ success: true, message: 'Sub-admin deleted' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getAuditLogs = async (req, res) => {
    try {
        const pool = require('../config/db');
        const { username, action, startDate, endDate } = req.query;
        let query = "SELECT * FROM audit_logs WHERE 1=1";
        const values = [];
        let paramIndex = 1;
        
        if (username) {
            query += ` AND username = $${paramIndex}`;
            values.push(username);
            paramIndex++;
        }
        if (action) {
            query += ` AND action = $${paramIndex}`;
            values.push(action);
            paramIndex++;
        }
        if (startDate) {
            query += ` AND created_at >= $${paramIndex}`;
            values.push(startDate);
            paramIndex++;
        }
        if (endDate) {
            query += ` AND created_at <= $${paramIndex}`;
            values.push(endDate);
            paramIndex++;
        }
        
        query += " ORDER BY created_at DESC LIMIT 100";
        const result = await pool.query(query, values);
        
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
