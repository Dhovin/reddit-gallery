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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
            console.log('[INFO] Found old settings.json. Migrating to SQLite settings.db...');
            const oldSettings = JSON.parse(fs.readFileSync(oldSettingsPath, 'utf8'));
            
            const insertStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
            
            db.exec('BEGIN TRANSACTION');
            if (oldSettings.subreddits) insertStmt.run('subreddits', JSON.stringify(oldSettings.subreddits));
            if (oldSettings.blockedUsers) insertStmt.run('blockedUsers', JSON.stringify(oldSettings.blockedUsers));
            if (oldSettings.favorites) insertStmt.run('favorites', JSON.stringify(oldSettings.favorites));
            if (oldSettings.presets) insertStmt.run('presets', JSON.stringify(oldSettings.presets));
            db.exec('COMMIT');
            
            console.log('[INFO] Migration complete. Renaming settings.json to settings.json.bak');
            fs.renameSync(oldSettingsPath, oldSettingsPath + '.bak');
        } catch (migrationErr) {
            console.error('[ERROR] Settings migration failed:', migrationErr);
            db.exec('ROLLBACK');
        }
    }
}

// Security Headers Middleware
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '1; mode=block');
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
    const { subreddits, blockedUsers, favorites, presets } = req.body;
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
            } catch (statErr) {}
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

// Allowed target hosts for proxying
const ALLOWED_PROXY_HOSTS = [
    'reddit.com', 'redditmedia.com', 'redd.it',
    'oauth.reddit.com', 'i.redd.it', 'preview.redd.it', 'external-preview.redd.it', 'v.redd.it',
    'redgifs.com', 'media.redgifs.com', 'v3.redgifs.com', 'thumbs2.redgifs.com', 'i.redgifs.com',
    'imgur.com', 'i.imgur.com'
];

function isHostAllowed(hostname) {
    return ALLOWED_PROXY_HOSTS.some(host => hostname === host || hostname.endsWith('.' + host));
}

// --- Reddit OAuth & API Token Manager ---
// Uses Reddit's official public installed_client authentication (same as Redlib / Reddit mobile app)
// Can be optionally overridden via REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET environment variables.
const REDDIT_DEFAULT_CLIENT_ID = 'ohXpoqrZYub1kg';
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || REDDIT_DEFAULT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';
const REDDIT_USER_AGENT = 'android:com.reddit.frontpage:v2024.12.0 (by /u/reddit)';

let cachedRedditToken = null;
let tokenExpiresAt = 0;
let tokenFetchPromise = null;

async function getRedditToken(forceRefresh = false) {
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
                throw new Error(`Invalid token response: ${JSON.stringify(tokenData)}`);
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
app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
        const parsedUrl = new URL(targetUrl);
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

            let token = await getRedditToken();
            let apiRes = await fetch(apiUrl.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': REDDIT_USER_AGENT
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
                        'User-Agent': REDDIT_USER_AGENT
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
app.post('/api/download-zip', async (req, res) => {
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
        let cleanName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
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
                        } catch (e) {}
                        archive.file(cacheFilePath, { name: finalFilename });
                        appended = true;
                        setTimeout(pruneCache, 100);
                        break;
                    } else {
                        try { fs.unlinkSync(cacheFilePath); } catch (e) {}
                    }
                }
            } catch (fetchErr) {
                // Continue to next candidate URL
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

