/**
 * Dynamically resolves the frontend client URL based on the request context.
 * 
 * @param {import('express').Request} req - The Express request object.
 * @returns {string} The resolved client URL origin.
 */
function getClientUrl(req) {
    // 1. Explicitly check query parameter
    if (req && req.query && req.query.client_url) {
        let clientUrl = req.query.client_url;
        try {
            const parsed = new URL(clientUrl);
            return parsed.origin;
        } catch (e) {
            if (typeof clientUrl === 'string') {
                return clientUrl.endsWith('/') ? clientUrl.slice(0, -1) : clientUrl;
            }
        }
    }

    // 2. Check Origin header (sent by browsers for fetch/XHR CORS requests)
    if (req && req.headers && req.headers.origin) {
        let origin = req.headers.origin;
        return origin.endsWith('/') ? origin.slice(0, -1) : origin;
    }

    // 3. Check Referer header (fallback for standard link redirects)
    if (req && req.headers && req.headers.referer) {
        try {
            const parsed = new URL(req.headers.referer);
            return parsed.origin;
        } catch (e) {
            // Ignore malformed referer headers
        }
    }

    // 4. Fallback to process.env.CLIENT_URL if defined
    if (process.env.CLIENT_URL) {
        let clientUrl = process.env.CLIENT_URL;
        return clientUrl.endsWith('/') ? clientUrl.slice(0, -1) : clientUrl;
    }

    // 5. Default fallback for development environment
    return 'http://localhost:5173';
}

module.exports = {
    getClientUrl
};
