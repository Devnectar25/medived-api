// Response cache for public catalog GET endpoints. The serialized and gzipped body is kept,
// so a hit costs neither a database round trip nor JSON/gzip work.
// Never use on a route whose response depends on the logged-in user.
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);

const MAX_ENTRIES = 300;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MIN_GZIP_BYTES = 1024;

const entries = new Map(); // key -> { expires, body, gz, etag, bytes }
const loading = new Map(); // key -> promise of { status, entry }
const clearListeners = [];
let totalBytes = 0;
let generation = 0;

const remove = (key) => {
    const entry = entries.get(key);
    if (!entry) return;
    totalBytes -= entry.bytes;
    entries.delete(key);
};

const store = (key, entry) => {
    remove(key);
    if (entry.bytes > MAX_TOTAL_BYTES / 4) return;
    entries.set(key, entry);
    totalBytes += entry.bytes;
    while (entries.size > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
        remove(entries.keys().next().value);
    }
};

const cacheKey = (req) => {
    const url = new URL(req.originalUrl, 'http://localhost');
    url.searchParams.sort();
    return url.pathname + url.search;
};

const send = (req, res, status, entry) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache'); // browsers revalidate with the ETag
    res.setHeader('ETag', entry.etag);
    res.vary('Accept-Encoding');
    if (status === 200 && req.headers['if-none-match'] === entry.etag) {
        res.statusCode = 304;
        return res.end();
    }
    const useGzip = entry.gz && req.acceptsEncodings('gzip') === 'gzip';
    const body = useGzip ? entry.gz : entry.body;
    if (useGzip) res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', body.length);
    return res.end(body);
};

exports.cachePublic = (ttlMs) => (req, res, next) => {
    if (req.method !== 'GET') return next();
    const key = cacheKey(req);
    if (key.length > 500) return next();

    // Admin screens fetch with cache: 'no-store' so they always see current data
    const bypass = /no-cache|no-store/.test(req.headers['cache-control'] || '');

    if (!bypass) {
        const hit = entries.get(key);
        if (hit && hit.expires > Date.now()) return send(req, res, 200, hit);
        const pending = loading.get(key);
        if (pending) {
            pending.then((result) => (result ? send(req, res, result.status, result.entry) : next()), next);
            return;
        }
    }

    let settle;
    const promise = new Promise((resolve) => { settle = resolve; });
    if (!bypass) loading.set(key, promise);
    const finish = (result) => {
        if (loading.get(key) === promise) loading.delete(key);
        settle(result);
    };

    const startGeneration = generation;
    res.json = (payload) => {
        const status = res.statusCode;
        (async () => {
            const body = Buffer.from(JSON.stringify(payload));
            const gz = body.length >= MIN_GZIP_BYTES ? await gzip(body, { level: 6 }) : null;
            const etag = `W/"${crypto.createHash('sha1').update(body).digest('base64url')}"`;
            const entry = { body, gz, etag, bytes: body.length + (gz ? gz.length : 0), expires: Date.now() + ttlMs };
            if (status === 200 && generation === startGeneration) store(key, entry);
            finish({ status, entry });
            if (!res.headersSent && !res.destroyed) send(req, res, status, entry);
        })().catch((err) => {
            finish(null);
            next(err);
        });
        return res;
    };
    // Client went away or the handler answered another way: let waiting requests run themselves
    res.on('close', () => finish(null));
    next();
};

const clear = () => {
    generation++;
    entries.clear();
    loading.clear();
    totalBytes = 0;
    clearListeners.forEach((fn) => fn());
};
exports.clear = clear;
exports.onClear = (fn) => clearListeners.push(fn);

// Clears the cache after a successful write, before the response reaches the client
exports.invalidateOnWrite = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/smart-search') return next();
    const json = res.json.bind(res);
    res.json = (payload) => {
        if (res.statusCode < 400) clear();
        return json(payload);
    };
    next();
};
