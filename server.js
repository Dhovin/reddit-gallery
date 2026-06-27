const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const CACHE_LIMIT = (parseInt(process.env.CACHE_LIMIT_GB) || 2) * 1024 * 1024 * 1024; // Default 2 GB

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Function to prune cache if it exceeds size limit (LRU based on modified time)
function pruneCache() {
    try {
        if (!fs.existsSync(CACHE_DIR)) return;

        const files = fs.readdirSync(CACHE_DIR);
        let totalSize = 0;
        const mediaFiles = [];

        for (const file of files) {
            const filePath = path.join(CACHE_DIR, file);
            const stats = fs.statSync(filePath);
            totalSize += stats.size;
            
            if (!file.endsWith('.json')) {
                mediaFiles.push({ name: file, path: filePath, size: stats.size, mtime: stats.mtimeMs });
            }
        }

        if (totalSize <= CACHE_LIMIT) {
            console.log(`[INFO] Cache size (${(totalSize / 1024 / 1024).toFixed(2)} MB) is within limits.`);
            return;
        }

        console.log(`[INFO] Cache size (${(totalSize / 1024 / 1024).toFixed(2)} MB) exceeds limit (${(CACHE_LIMIT / 1024 / 1024).toFixed(2)} MB). Pruning oldest files...`);

        // Sort media files by modified time (oldest first)
        mediaFiles.sort((a, b) => a.mtime - b.mtime);

        let freedSpace = 0;
        for (const file of mediaFiles) {
            if (totalSize - freedSpace <= CACHE_LIMIT) {
                break;
            }

            try {
                // Delete media file
                fs.unlinkSync(file.path);
                freedSpace += file.size;

                // Delete corresponding metadata file if it exists
                const metaPath = file.path + '.json';
                if (fs.existsSync(metaPath)) {
                    const metaStats = fs.statSync(metaPath);
                    fs.unlinkSync(metaPath);
                    freedSpace += metaStats.size;
                }
                
                console.log(`[DEBUG] Deleted cache item: ${file.name} (freed ${(file.size / 1024 / 1024).toFixed(2)} MB)`);
            } catch (err) {
                console.error(`[ERROR] Failed to delete cache item ${file.path}:`, err);
            }
        }
        console.log(`[INFO] Cache pruning completed. Freed ${(freedSpace / 1024 / 1024).toFixed(2)} MB.`);
    } catch (err) {
        console.error('[ERROR] Error pruning cache:', err);
    }
}

// Initial cache pruning run on server start
setTimeout(pruneCache, 2000);

// Load settings
app.get('/api/settings', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    console.log('[DEBUG] GET /api/settings: Request received');
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            console.log(`[INFO] GET /api/settings: Loaded settings from file. Subreddits count: ${parsed.subreddits?.length || 0}, Favorites count: ${parsed.favorites?.length || 0}`);
            return res.json(parsed);
        }
        console.log('[INFO] GET /api/settings: Settings file settings.json does not exist. Returning empty defaults.');
        res.json({});
    } catch (err) {
        console.error('[ERROR] GET /api/settings: Error reading settings file:', err);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

// Save settings
app.post('/api/settings', (req, res) => {
    console.log('[DEBUG] POST /api/settings: Request received');
    try {
        const settings = req.body;
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
        console.log(`[INFO] POST /api/settings: Saved settings successfully. Subreddits: ${settings.subreddits?.length || 0}, Blocked Users: ${settings.blockedUsers?.length || 0}, Favorites: ${settings.favorites?.length || 0}, Presets: ${Object.keys(settings.presets || {}).length}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[ERROR] POST /api/settings: Error writing settings file:', err);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Built-in proxy to bypass CORS and stream/cache media
app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        console.warn('[WARN] GET /api/proxy: Missing url parameter');
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
        // Validate target URL to prevent SSRF
        const parsedUrl = new URL(targetUrl);
        const allowedHosts = [
            'reddit.com', 'redditmedia.com', 'redd.it',
            'redgifs.com', 'media.redgifs.com', 'v3.redgifs.com'
        ];
        const isAllowed = allowedHosts.some(host => parsedUrl.hostname === host || parsedUrl.hostname.endsWith('.' + host));
        if (!isAllowed) {
            console.warn(`[WARN] GET /api/proxy: Forbidden target host requested: ${parsedUrl.hostname}`);
            return res.status(403).json({ error: 'Forbidden target host' });
        }

        // Cache resolution
        const urlHash = crypto.createHash('md5').update(targetUrl).digest('hex');
        const cacheFilePath = path.join(CACHE_DIR, urlHash);
        const metadataPath = cacheFilePath + '.json';

        if (fs.existsSync(cacheFilePath) && fs.existsSync(metadataPath)) {
            try {
                const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                console.log(`[INFO] GET /api/proxy: Serving from cache: ${targetUrl}`);
                
                res.setHeader('Content-Type', metadata.contentType);
                const stats = fs.statSync(cacheFilePath);
                res.setHeader('Content-Length', stats.size);
                
                // Update modified times to mark recently used (for LRU pruning)
                const now = new Date();
                fs.utimesSync(cacheFilePath, now, now);
                fs.utimesSync(metadataPath, now, now);

                fs.createReadStream(cacheFilePath).pipe(res);
                return;
            } catch (cacheErr) {
                console.error('[ERROR] GET /api/proxy: Failed to read from cache, refetching...', cacheErr);
            }
        }

        console.log(`[DEBUG] GET /api/proxy: Cache miss. Fetching from target: ${targetUrl}`);
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 RedditGalleryDocker/1.0.0'
            }
        });

        if (!response.ok) {
            console.warn(`[WARN] GET /api/proxy: Fetch failed for target. Host returned HTTP ${response.status}`);
            return res.status(response.status).json({ error: `Reddit/RedGIFS API returned HTTP ${response.status}` });
        }

        const contentType = response.headers.get('content-type') || '';
        console.log(`[INFO] GET /api/proxy: Successfully fetched target. Status: ${response.status}, Content-Type: ${contentType}`);

        if (contentType.includes('application/json')) {
            const data = await response.json();
            res.json(data);
        } else {
            // Stream binary media back to client and cache it to disk
            res.setHeader('Content-Type', contentType);
            const contentLength = response.headers.get('content-length');
            if (contentLength) {
                res.setHeader('Content-Length', contentLength);
            }

            const { Readable } = require('stream');
            const nodeStream = Readable.fromWeb(response.body);

            // Setup write stream to cache file
            const writeStream = fs.createWriteStream(cacheFilePath);
            
            // Pipe the stream to both response and writeStream
            nodeStream.pipe(res);
            nodeStream.pipe(writeStream);

            writeStream.on('finish', () => {
                try {
                    fs.writeFileSync(metadataPath, JSON.stringify({ contentType, targetUrl, savedAt: Date.now() }), 'utf8');
                    console.log(`[INFO] GET /api/proxy: Cached media successfully for: ${targetUrl}`);
                    // Run pruning in background
                    setTimeout(pruneCache, 100);
                } catch (writeMetaErr) {
                    console.error('[ERROR] GET /api/proxy: Failed to save cache metadata:', writeMetaErr);
                }
            });

            writeStream.on('error', (writeErr) => {
                console.error('[ERROR] GET /api/proxy: Cache write stream error:', writeErr);
                // Clean up partial cache files
                try { fs.unlinkSync(cacheFilePath); } catch (e) {}
                try { fs.unlinkSync(metadataPath); } catch (e) {}
            });
        }
    } catch (err) {
        console.error('[ERROR] GET /api/proxy: Proxy error occurred:', err);
        res.status(500).json({ error: err.message || 'Failed to fetch' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
