const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key';

exports.protect = (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization?.split(' ')[1];
    }

    if (!token) {
        console.warn(`[Auth] No token on ${req.method} ${req.path}. Headers: ${Object.keys(req.headers).join(', ')}`);
        return res.status(401).json({ success: false, message: 'Not authorized to access this route' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Valid token required' });
    }
};

exports.authorize = (...roles) => {
    return (req, res, next) => {
        console.log(`[Authorize] Required: ${roles.join('/')}, Got: ${req.user?.role}, ID: ${req.user?.id}`);
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `User role ${req.user.role} is not authorized to access this route`
            });
        }
        next();
    };
};

exports.checkPermission = (permission) => {
    return async (req, res, next) => {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Access denied: Requires admin role' });
        }
        
        try {
            const pool = require('../config/db');
            const result = await pool.query("SELECT * FROM public.admins WHERE adminid = $1", [req.user.id]);
            const admin = result.rows[0];
            
            if (!admin) {
                return res.status(403).json({ success: false, message: 'Admin not found' });
            }
            
            // Check permissions
            let hasAccess = false;
            if (admin.userid === 'Admin') {
                hasAccess = true;
            } else {
                const permissions = admin.accesstopage || [];
                if (permissions.includes(permission)) {
                    hasAccess = true;
                }
            }
            
            const ipAddress = req.ip || req.connection?.remoteAddress || '';
            
            if (!hasAccess) {
                // Log unauthorized access
                await pool.query("INSERT INTO audit_logs (admin_id, username, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)", 
                    [admin.adminid, admin.userid, 'UNAUTHORIZED_ACCESS', `Attempted to access ${req.originalUrl} (${permission})`, ipAddress]);
                return res.status(403).json({ success: false, message: `Access denied for module: ${permission}` });
            }
            
            // Log successful access
            await pool.query("INSERT INTO audit_logs (admin_id, username, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)", 
                [admin.adminid, admin.userid, 'PAGE_ACCESS', `Accessed ${req.originalUrl}`, ipAddress]);
            
            next();
        } catch (error) {
            console.error('[checkPermission] Error:', error);
            res.status(500).json({ success: false, message: 'Server error checking permissions' });
        }
    };
};
