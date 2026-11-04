const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const archiver = require('archiver');
const { DatabaseSync } = require('node:sqlite');

const log = {
    info: (msg, ...args) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`, ...args),
};

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'settings.db');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const CACHE_LIMIT = (parseInt(process.env.CACHE_LIMIT_GB) || 2) * 1024 * 1024 * 1024; // Default 2 GB

// Disable server software fingerprinting
app.disable('x-powered-by');

// Request & Error Logging Middleware
app.use((req, res, next) => {
    const start = Date.now();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    res.on('finish', () => {
        const duration = Date.now() - start;
        const status = res.statusCode;
        const msg = `${req.method} ${req.originalUrl || req.url} ${status} - ${duration}ms [${ip}]`;
        if (status >= 500) {
            log.error(msg);
        } else if (status >= 400) {
            log.warn(msg);
        } else {
            log.info(msg);
        }
    });
    next();
});

// Input parsing with secure payload limits
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Ensure data and cache directories exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Initialize SQLite database
const db = new DatabaseSync(DB_FILE);

// Setup settings table
db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )
`);

// Auto-Migration from settings.json (if table is empty and JSON exists)
const checkStmt = db.prepare('SELECT COUNT(*) as count FROM settings');
if (checkStmt.get().count === 0) {
    const oldSettingsPath = path.join(DATA_DIR, 'settings.json');
    if (fs.existsSync(oldSettingsPath)) {
        try {
            log.info('Found old settings.json. Migrating to SQLite settings.db...');
            const oldSettings = JSON.parse(fs.readFileSync(oldSettingsPath, 'utf8'));
            
            const insertStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
            
            db.exec('BEGIN TRANSACTION');
            if (oldSettings.subreddits) insertStmt.run('subreddits', JSON.stringify(oldSettings.subreddits));
            if (oldSettings.blockedUsers) insertStmt.run('blockedUsers', JSON.stringify(oldSettings.blockedUsers));
            if (oldSettings.favorites) insertStmt.run('favorites', JSON.stringify(oldSettings.favorites));
            if (oldSettings.presets) insertStmt.run('presets', JSON.stringify(oldSettings.presets));
            db.exec('COMMIT');
            
            log.info('Migration complete. Renaming settings.json to settings.json.bak');
            fs.renameSync(oldSettingsPath, oldSettingsPath + '.bak');
        } catch (migrationErr) {
            log.error('Settings migration failed:', migrationErr);
            db.exec('ROLLBACK');
        }
    }
}

// Security Headers Middleware
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: https:; " +
        "media-src 'self' blob: https:; " +
        "connect-src 'self' https://oauth.reddit.com https://www.reddit.com https://*.redgifs.com https://*.imgur.com; " +
        "frame-ancestors 'self';"
    );
    next();
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// GET Health Check (Used by Docker HEALTHCHECK and monitoring)
app.get('/api/health', (req, res) => {
    try {
        const stmt = db.prepare('SELECT 1 as healthy');
        const dbStatus = stmt.get().healthy === 1 ? 'ok' : 'degraded';
        const mem = process.memoryUsage();
        res.json({
            status: 'healthy',
            uptimeSeconds: Math.floor(process.uptime()),
            db: dbStatus,
            memory: {
                rssMB: Math.round(mem.rss / 1024 / 1024),
                heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
                heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024)
            }
        });
    } catch (err) {
        log.error('Health check failed:', err);
        res.status(500).json({ status: 'unhealthy', error: err.message });
    }
});

// GET Settings
app.get('/api/settings', (req, res) => {
    try {
        const selectStmt = db.prepare('SELECT key, value FROM settings');
        const rows = selectStmt.all();
        
        const settings = {};
        rows.forEach(row => {
            settings[row.key] = JSON.parse(row.value);
        });

        res.json({
            subreddits: settings.subreddits || [],
            blockedUsers: settings.blockedUsers || [],
            favorites: settings.favorites || [],
            presets: settings.presets || {}
        });
    } catch (err) {
        log.error('GET /api/settings failed:', err);
        res.status(500).json({ error: 'Failed to retrieve settings' });
    }
});

// POST Settings
app.post('/api/settings', (req, res) => {
    const { subreddits, blockedUsers, favorites, presets } = req.body || {};

    if (subreddits !== undefined && !Array.isArray(subreddits)) {
        log.warn('POST /api/settings: "subreddits" must be an array');
        return res.status(400).json({ error: '"subreddits" must be an array' });
    }
    if (blockedUsers !== undefined && !Array.isArray(blockedUsers)) {
        log.warn('POST /api/settings: "blockedUsers" must be an array');
        return res.status(400).json({ error: '"blockedUsers" must be an array' });
    }
    if (favorites !== undefined && !Array.isArray(favorites)) {
        log.warn('POST /api/settings: "favorites" must be an array');
        return res.status(400).json({ error: '"favorites" must be an array' });
    }
    if (presets !== undefined && (typeof presets !== 'object' || presets === null || Array.isArray(presets))) {
        log.warn('POST /api/settings: "presets" must be an object');
        return res.status(400).json({ error: '"presets" must be an object' });
    }

    const insertStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    db.exec('BEGIN TRANSACTION');
    try {
        if (subreddits !== undefined) insertStmt.run('subreddits', JSON.stringify(subreddits));
        if (blockedUsers !== undefined) insertStmt.run('blockedUsers', JSON.stringify(blockedUsers));
        if (favorites !== undefined) insertStmt.run('favorites', JSON.stringify(favorites));
        if (presets !== undefined) insertStmt.run('presets', JSON.stringify(presets));
        
        db.exec('COMMIT');
        res.json({ success: true });
    } catch (err) {
        db.exec('ROLLBACK');
        log.error('POST /api/settings failed:', err);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// LRU cache pruning logic
function pruneCache() {
    if (!fs.existsSync(CACHE_DIR)) return;
    try {
        const files = fs.readdirSync(CACHE_DIR);
        let cacheFiles = [];
        let totalSize = 0;
        
        files.forEach(file => {
            if (file.endsWith('.json')) return;
            const filePath = path.join(CACHE_DIR, file);
            try {
                const stats = fs.statSync(filePath);
                if (stats.isDirectory()) return;
                totalSize += stats.size;
                cacheFiles.push({
                    name: file,
                    path: filePath,
                    size: stats.size,
                    mtime: stats.mtimeMs
                });
            } catch (statErr) {
                log.warn(`Cache prune: Could not stat file ${filePath}: ${statErr.message}`);
            }
        });

        if (totalSize <= CACHE_LIMIT) return;

        log.info(`Cache size (${(totalSize / 1024 / 1024).toFixed(2)} MB) exceeds limit (${(CACHE_LIMIT / 1024 / 1024).toFixed(2)} MB). Pruning...`);
        
        // Sort by modification time (oldest first)
        cacheFiles.sort((a, b) => a.mtime - b.mtime);

        for (const file of cacheFiles) {
            try {
                fs.unlinkSync(file.path);
                const metaPath = file.path + '.json';
                if (fs.existsSync(metaPath)) {
                    fs.unlinkSync(metaPath);
                }
                totalSize -= file.size;
                log.info(`Deleted cache file: ${file.name}`);
                if (totalSize <= CACHE_LIMIT) break;
            } catch (delErr) {
                log.error(`Failed to delete cache file ${file.name}:`, delErr);
            }
        }
    } catch (err) {
        log.error('Failed to prune cache:', err);
    }
}

// In-Memory Sliding-Window Rate Limiter
function createRateLimiter(windowMs, maxRequests) {
    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [ip, record] of hits.entries()) {
            if (now > record.resetAt) {
                hits.delete(ip);
            }
        }
    }, 5 * 60 * 1000).unref();

    return (req, res, next) => {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        let record = hits.get(ip);
        if (!record || now > record.resetAt) {
            record = { count: 0, resetAt: now + windowMs };
            hits.set(ip, record);
        }
        record.count++;
        if (record.count > maxRequests) {
            log.warn(`Rate limit exceeded for IP ${ip} on ${req.method} ${req.path}`);
            res.setHeader('Retry-After', Math.ceil((record.resetAt - now) / 1000));
            return res.status(429).json({ error: 'Too many requests, please try again later.' });
        }
        next();
    };
}

const proxyRateLimiter = createRateLimiter(60 * 1000, 180); // 180 requests per minute
const downloadRateLimiter = createRateLimiter(60 * 1000, 15); // 15 downloads per minute

// Allowed target hosts for proxying
const ALLOWED_PROXY_HOSTS = [
    'reddit.com', 'redditmedia.com', 'redd.it',
    'oauth.reddit.com', 'i.redd.it', 'preview.redd.it', 'external-preview.redd.it', 'v.redd.it',
    'redgifs.com', 'media.redgifs.com', 'v3.redgifs.com', 'thumbs2.redgifs.com', 'i.redgifs.com',
    'imgur.com', 'i.imgur.com'
];

function isPrivateIpOrHost(hostname) {
    const lower = (hostname || '').toLowerCase();
    if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1' || lower === '0.0.0.0') return true;
    const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
        const b0 = parseInt(ipv4Match[1], 10);
        const b1 = parseInt(ipv4Match[2], 10);
        if (b0 === 10) return true;
        if (b0 === 127) return true;
        if (b0 === 169 && b1 === 254) return true;
        if (b0 === 192 && b1 === 168) return true;
        if (b0 === 172 && (b1 >= 16 && b1 <= 31)) return true;
    }
    return false;
}

function isHostAllowed(hostname) {
    if (!hostname || typeof hostname !== 'string') return false;
    const host = hostname.toLowerCase().replace(/\.$/, '');
    if (isPrivateIpOrHost(host)) return false;
    return ALLOWED_PROXY_HOSTS.some(allowed => host === allowed || host.endsWith('.' + allowed));
}

// --- Reddit OAuth & API Token Manager ---
// Credentials configured strictly via REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET environment variables.
const REDDIT_CLIENT_ID = (process.env.REDDIT_CLIENT_ID || '').trim();
const REDDIT_CLIENT_SECRET = (process.env.REDDIT_CLIENT_SECRET || '').trim();
const REDDIT_USER_AGENT = 'android:com.reddit.frontpage:v2024.12.0 (by /u/reddit)';

let cachedRedditToken = null;
let tokenExpiresAt = 0;
let tokenFetchPromise = null;

async function getRedditToken(forceRefresh = false) {
    if (!REDDIT_CLIENT_ID) {
        log.warn('REDDIT_CLIENT_ID is not configured. Reddit API calls will fail without authentication.');
        throw new Error('REDDIT_CLIENT_ID environment variable is missing.');
    }

    const now = Date.now();
    if (!forceRefresh && cachedRedditToken && tokenExpiresAt > now + 60000) {
        return cachedRedditToken;
    }

    if (tokenFetchPromise) {
        return tokenFetchPromise;
    }

    tokenFetchPromise = (async () => {
        try {
            log.info('Acquiring Reddit OAuth access token...');
            const isCustomAuth = Boolean(REDDIT_CLIENT_SECRET);
            const authHeader = 'Basic ' + Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');

            const params = new URLSearchParams();
            if (isCustomAuth) {
                params.append('grant_type', 'client_credentials');
            } else {
                params.append('grant_type', 'https://oauth.reddit.com/grants/installed_client');
                params.append('device_id', crypto.randomUUID());
            }

            const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                    'User-Agent': REDDIT_USER_AGENT,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params.toString(),
                signal: AbortSignal.timeout(10000)
            });

            if (!tokenRes.ok) {
                const errText = await tokenRes.text().catch(() => '');
                throw new Error(`Reddit token endpoint returned HTTP ${tokenRes.status}: ${errText.slice(0, 200)}`);
            }

            const tokenData = await tokenRes.json();
            if (!tokenData.access_token) {
                const errMsg = tokenData.error || 'Token response missing access_token';
                throw new Error(`Reddit API token acquisition failed: ${errMsg}`);
            }

            cachedRedditToken = tokenData.access_token;
            const expiresInSec = tokenData.expires_in || 3600;
            tokenExpiresAt = Date.now() + (expiresInSec * 1000);
            log.info(`Reddit OAuth token acquired successfully (expires in ${expiresInSec}s)`);
            return cachedRedditToken;
        } catch (err) {
            log.error('Failed to obtain Reddit OAuth token:', err.message);
            throw err;
        } finally {
            tokenFetchPromise = null;
        }
    })();

    return tokenFetchPromise;
}

// Request pacer for Reddit API to avoid rapid bursts triggering 429 rate limits
let lastRedditApiCallTime = 0;
const REDDIT_MIN_REQUEST_INTERVAL_MS = 60;
async function paceRedditRequest() {
    const now = Date.now();
    const timeSinceLast = now - lastRedditApiCallTime;
    if (timeSinceLast < REDDIT_MIN_REQUEST_INTERVAL_MS) {
        await new Promise(r => setTimeout(r, REDDIT_MIN_REQUEST_INTERVAL_MS - timeSinceLast));
    }
    lastRedditApiCallTime = Date.now();
}

function isRedditApiRequest(parsedUrl) {
    const host = parsedUrl.hostname.toLowerCase();
    const isReddit = host === 'reddit.com' || host.endsWith('.reddit.com');
    if (!isReddit) return false;
    const path = parsedUrl.pathname.toLowerCase();
    return path.endsWith('.json') || path.includes('/r/') || path.includes('/user/') || path.includes('/api/');
}

// GET Proxy Endpoint (fetches and streams media streams, caches files locally)
app.get('/api/proxy', proxyRateLimiter, async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl || typeof targetUrl !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid url parameter' });
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(targetUrl);
    } catch (urlErr) {
        return res.status(400).json({ error: 'Malformed URL' });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        log.warn(`GET /api/proxy: Non-HTTP protocol rejected: ${parsedUrl.protocol}`);
        return res.status(400).json({ error: 'Only http and https protocols are supported' });
    }

    try {
        if (!isHostAllowed(parsedUrl.hostname)) {
            log.warn(`GET /api/proxy: Forbidden target host requested: ${parsedUrl.hostname}`);
            return res.status(403).json({ error: 'Forbidden target host' });
        }

        // Intercept Reddit JSON API / Feed requests and route through oauth.reddit.com
        if (isRedditApiRequest(parsedUrl)) {
            await paceRedditRequest();

            const apiUrl = new URL(targetUrl);
            apiUrl.hostname = 'oauth.reddit.com';
            apiUrl.protocol = 'https:';
            if (!apiUrl.searchParams.has('raw_json')) apiUrl.searchParams.set('raw_json', '1');
            if (!apiUrl.searchParams.has('include_over_18')) apiUrl.searchParams.set('include_over_18', '1');

            // Reddit WAF / edge security blocks /r/{sub}/new.json and /r/{sub}/rising.json with HTTP 403 network security blocks.
            // Rewriting /r/{sub}/{sort}.json (or /r/{sub}/{sort}) to /r/{sub}.json?sort={sort} routes through the unblocked endpoint.
            const subSortMatch = apiUrl.pathname.match(/^\/r\/([^/]+)\/(new|rising|hot|top|controversial)(?:\.json)?$/i);
            if (subSortMatch) {
                const sub = subSortMatch[1];
                const sort = subSortMatch[2].toLowerCase();
                apiUrl.pathname = `/r/${sub}.json`;
                if (!apiUrl.searchParams.has('sort')) {
                    apiUrl.searchParams.set('sort', sort);
                }
            } else {
                const subOnlyMatch = apiUrl.pathname.match(/^\/r\/([^/]+)\/?$/i);
                if (subOnlyMatch && !subOnlyMatch[1].endsWith('.json')) {
                    apiUrl.pathname = `/r/${subOnlyMatch[1]}.json`;
                }
            }

            if (apiUrl.searchParams.get('after') === '') {
                apiUrl.searchParams.delete('after');
            }

            let token = await getRedditToken();
            let apiRes = await fetch(apiUrl.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': REDDIT_USER_AGENT,
                    'Accept': 'application/json'
                },
                signal: AbortSignal.timeout(15000)
            });

            // If token expired (401), force refresh and retry once
            if (apiRes.status === 401) {
                log.warn('Reddit API returned 401 Unauthorized. Refreshing OAuth token and retrying...');
                token = await getRedditToken(true);
                apiRes = await fetch(apiUrl.toString(), {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'User-Agent': REDDIT_USER_AGENT,
                        'Accept': 'application/json'
                    },
                    signal: AbortSignal.timeout(15000)
                });
            }

            if (!apiRes.ok) {
                const errText = await apiRes.text().catch(() => '');
                log.warn(`GET /api/proxy (Reddit API): Remote returned HTTP ${apiRes.status} for ${apiUrl.pathname}: ${errText.slice(0, 150)}`);
                return res.status(apiRes.status).json({ error: `Reddit API returned HTTP ${apiRes.status}` });
            }

            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            const nodeStream = Readable.fromWeb(apiRes.body);
            nodeStream.on('error', (streamErr) => {
                log.warn(`GET /api/proxy (Reddit API): Stream error: ${streamErr.message}`);
                if (!res.headersSent) res.status(502).json({ error: 'Remote stream error' });
            });
            res.on('close', () => {
                if (!res.writableEnded) {
                    try { nodeStream.destroy(); } catch (e) {}
                }
            });
            nodeStream.pipe(res);
            return;
        }

        const urlHash = crypto.createHash('md5').update(targetUrl).digest('hex');
        const cacheFilePath = path.join(CACHE_DIR, urlHash);
        const metadataPath = cacheFilePath + '.json';

        // Check if file is in cache
        if (fs.existsSync(cacheFilePath) && fs.existsSync(metadataPath)) {
            try {
                const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                res.setHeader('Content-Type', metadata.contentType);
                const stats = fs.statSync(cacheFilePath);
                res.setHeader('Content-Length', stats.size);
                
                // Update access times for LRU
                const now = new Date();
                fs.utimesSync(cacheFilePath, now, now);
                fs.utimesSync(metadataPath, now, now);

                const readStream = fs.createReadStream(cacheFilePath);
                readStream.on('error', (cacheReadErr) => {
                    log.warn('Cache read stream error:', cacheReadErr.message);
                    if (!res.headersSent) res.status(500).json({ error: 'Failed to stream cached file' });
                });
                readStream.pipe(res);
                return;
            } catch (cacheErr) {
                log.error('GET /api/proxy: Failed to read from cache, refetching...', cacheErr);
            }
        }

        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            log.warn(`GET /api/proxy: Fetch failed for target (${response.status}): ${targetUrl}`);
            return res.status(response.status).json({ error: `Media provider returned HTTP ${response.status}` });
        }

        const contentType = response.headers.get('content-type') || '';
        res.setHeader('Content-Type', contentType);

        const contentLength = response.headers.get('content-length');
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        const nodeStream = Readable.fromWeb(response.body);
        const writeStream = fs.createWriteStream(cacheFilePath);

        let isCleanedUp = false;
        const cleanupStreams = () => {
            if (isCleanedUp) return;
            isCleanedUp = true;
            try { nodeStream.destroy(); } catch (e) {}
            try { writeStream.destroy(); } catch (e) {}
        };

        // Handle remote stream abort / disconnection without crashing the process
        nodeStream.on('error', (streamErr) => {
            log.warn(`GET /api/proxy: Remote stream aborted (${parsedUrl.hostname}):`, streamErr.message);
            cleanupStreams();
            try { fs.unlinkSync(cacheFilePath); } catch (e) {}
            try { fs.unlinkSync(metadataPath); } catch (e) {}
        });

        writeStream.on('error', (writeErr) => {
            log.warn(`GET /api/proxy: Cache write error for ${urlHash}:`, writeErr.message);
            cleanupStreams();
            try { fs.unlinkSync(cacheFilePath); } catch (e) {}
            try { fs.unlinkSync(metadataPath); } catch (e) {}
        });

        // Client aborted/navigated away before media finished streaming
        res.on('close', () => {
            if (!res.writableEnded) {
                cleanupStreams();
                try { fs.unlinkSync(cacheFilePath); } catch (e) {}
                try { fs.unlinkSync(metadataPath); } catch (e) {}
            }
        });

        writeStream.on('finish', () => {
            try {
                fs.writeFileSync(metadataPath, JSON.stringify({ contentType, targetUrl, savedAt: Date.now() }), 'utf8');
                setTimeout(pruneCache, 100);
            } catch (metaErr) {
                log.error('Failed to save metadata:', metaErr);
            }
        });

        // Pipe to response immediately and save to cache file
        nodeStream.pipe(res);
        nodeStream.pipe(writeStream);

    } catch (err) {
        log.error('GET /api/proxy failed:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message || 'Failed to fetch resource' });
        }
    }
});

// POST Streaming ZIP Download Endpoint
app.post('/api/download-zip', downloadRateLimiter, async (req, res) => {
    let items = [];
    if (req.body && req.body.payload) {
        try {
            const parsed = typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body.payload;
            items = parsed.items || [];
        } catch (e) {
            log.error('Failed to parse download payload:', e);
        }
    } else if (req.body && req.body.items) {
        items = req.body.items;
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).send('No items specified for download.');
    }

    if (items.length > 500) {
        log.warn(`POST /api/download-zip: Payload exceeds 500 item limit (${items.length} items requested)`);
        return res.status(400).send('Maximum download limit is 500 items per request.');
    }

    log.info(`Starting streaming ZIP generation for ${items.length} items...`);

    const zipFilename = `reddit_gallery_${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.setHeader('Transfer-Encoding', 'chunked');

    function createZipArchive(options) {
        if (typeof archiver === 'function') {
            return archiver('zip', options);
        }
        if (archiver && archiver.ZipArchive) {
            return new archiver.ZipArchive(options);
        }
        if (archiver && archiver.default && typeof archiver.default === 'function') {
            return archiver.default('zip', options);
        }
        throw new Error('Unsupported archiver module structure');
    }

    const archive = createZipArchive({
        store: true, // No CPU-heavy compression for media files already compressed
        zlib: { level: 0 }
    });

    archive.on('error', (err) => {
        log.error('Archiver error:', err);
        if (!res.headersSent) {
            res.status(500).send('Failed to generate ZIP archive');
        }
    });

    let isAborted = false;
    res.on('close', () => {
        if (!res.writableEnded) {
            log.info('Client closed connection before ZIP completion.');
            isAborted = true;
            try { archive.abort(); } catch (e) {}
        }
    });

    archive.pipe(res);

    const usedFilenames = new Set();

    for (const item of items) {
        if (isAborted) break;
        const primaryUrl = item.url;
        const candidateUrls = [primaryUrl, ...(item.fallbackUrls || [])].filter(Boolean);
        if (candidateUrls.length === 0) continue;

        let rawName = (primaryUrl || '').split('/').pop().split('?')[0] || 'media';
        let cleanName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+/, '');
        let ext = '';
        const match = cleanName.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm)$/i);
        if (match) {
            ext = match[0].toLowerCase();
            cleanName = cleanName.slice(0, -ext.length);
        } else {
            ext = (item.type === 'video') ? '.mp4' : '.jpg';
        }
        if (!cleanName) cleanName = 'media';

        let finalFilename = `${cleanName}${ext}`;
        let counter = 1;
        while (usedFilenames.has(finalFilename.toLowerCase())) {
            finalFilename = `${cleanName}_${counter}${ext}`;
            counter++;
        }
        usedFilenames.add(finalFilename.toLowerCase());

        let appended = false;

        for (const targetUrl of candidateUrls) {
            if (appended || isAborted) break;

            try {
                const parsedUrl = new URL(targetUrl);
                if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') continue;
                if (!isHostAllowed(parsedUrl.hostname)) continue;

                const urlHash = crypto.createHash('md5').update(targetUrl).digest('hex');
                const cacheFilePath = path.join(CACHE_DIR, urlHash);
                const metadataPath = cacheFilePath + '.json';

                // Check local cache first
                if (fs.existsSync(cacheFilePath) && fs.existsSync(metadataPath)) {
                    if (!isAborted) {
                        archive.file(cacheFilePath, { name: finalFilename });
                        const now = new Date();
                        try {
                            fs.utimesSync(cacheFilePath, now, now);
                            fs.utimesSync(metadataPath, now, now);
                        } catch (e) {}
                        appended = true;
                    }
                    break;
                }

                // If not cached, fetch directly with timeout
                const response = await fetch(targetUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    },
                    signal: AbortSignal.timeout(20000)
                });

                if (response.ok && !isAborted) {
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.includes('text/html') || contentType.includes('application/json')) {
                        continue;
                    }

                    // Stream directly to file on disk via pipeline (no RAM buffering)
                    const writeStream = fs.createWriteStream(cacheFilePath);
                    const nodeStream = Readable.fromWeb(response.body);

                    await pipeline(nodeStream, writeStream);

                    const stats = fs.statSync(cacheFilePath);
                    if (stats.size > 1000 && !isAborted) {
                        try {
                            fs.writeFileSync(metadataPath, JSON.stringify({ contentType, targetUrl, savedAt: Date.now() }), 'utf8');
                        } catch (metaErr) {
                            log.warn(`ZIP generation: Failed to save metadata for ${cacheFilePath}: ${metaErr.message}`);
                        }
                        archive.file(cacheFilePath, { name: finalFilename });
                        appended = true;
                        setTimeout(pruneCache, 100);
                        break;
                    } else {
                        try { fs.unlinkSync(cacheFilePath); } catch (unlinkErr) {
                            log.warn(`ZIP generation: Failed to clean incomplete file ${cacheFilePath}: ${unlinkErr.message}`);
                        }
                    }
                }
            } catch (fetchErr) {
                log.warn(`ZIP generation: Failed to fetch candidate URL ${targetUrl}: ${fetchErr.message}`);
            }
        }

        if (!appended && !isAborted) {
            log.warn(`ZIP generation: Could not download media for: ${primaryUrl}`);
        }
    }

    if (!isAborted) {
        try {
            await archive.finalize();
            log.info(`Completed ZIP archive stream: ${zipFilename}`);
        } catch (finalErr) {
            log.error('Failed to finalize archive:', finalErr);
        }
    }
});

// POST Client Log Ingestion Endpoint (captures frontend errors into server/Docker logs)
app.post('/api/client-log', (req, res) => {
    try {
        const { level, message, details, url } = req.body || {};
        const cleanMsg = typeof message === 'string' ? message.slice(0, 500) : 'Unknown client event';
        const logPrefix = `[CLIENT${url ? ' ' + url : ''}] ${cleanMsg}`;

        if (level === 'warn') {
            log.warn(logPrefix, details || '');
        } else if (level === 'info') {
            log.info(logPrefix, details || '');
        } else {
            log.error(logPrefix, details || '');
        }
        res.json({ success: true });
    } catch (e) {
        log.warn('Failed to process client log:', e.message);
        res.status(400).json({ error: 'Invalid client log payload' });
    }
});

// Global Express error handler (catches bad payloads, malformed JSON, etc.)
app.use((err, req, res, next) => {
    log.error('Express request error:', err);
    if (!res.headersSent) {
        res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
});

const server = app.listen(PORT, () => {
    log.info(`Server running on port ${PORT}`);
    log.info(`Settings database: ${DB_FILE}`);
});

// Process signal and error guards
process.on('uncaughtException', (err) => {
    log.error('[CRITICAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

function gracefulShutdown(signal) {
    log.info(`Received ${signal} signal. Shutting down gracefully...`);
    server.close(() => {
        log.info('HTTP server closed.');
        try {
            db.close();
            log.info('SQLite database closed successfully.');
        } catch (dbErr) {
            log.error('Error closing SQLite database:', dbErr);
        }
        process.exit(0);
    });

    // Fallback force exit after 10 seconds if connections hang
    setTimeout(() => {
        log.warn('Graceful shutdown timed out after 10s. Forcing exit.');
        process.exit(1);
    }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

