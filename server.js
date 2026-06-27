const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

// Built-in proxy to bypass CORS and stream media
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

        console.log(`[DEBUG] GET /api/proxy: Proxying request for: ${targetUrl}`);
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
            // Stream binary media back to client
            res.setHeader('Content-Type', contentType);
            const contentLength = response.headers.get('content-length');
            if (contentLength) {
                res.setHeader('Content-Length', contentLength);
            }
            const { Readable } = require('stream');
            Readable.fromWeb(response.body).pipe(res);
        }
    } catch (err) {
        console.error('[ERROR] GET /api/proxy: Proxy error occurred:', err);
        res.status(500).json({ error: err.message || 'Failed to fetch' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
