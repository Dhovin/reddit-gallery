const express = require('express');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3031;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'settings.db');

app.use(express.json({ limit: '10mb' }));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
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

// Serve frontend build static files
app.use(express.static(path.join(__dirname, 'dist')));

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
        console.error('[ERROR] GET /api/settings failed:', err);
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
        console.error('[ERROR] POST /api/settings failed:', err);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// GET Proxy Endpoint (Nginx acts as front cache, Node acts as fetch client)
app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
        const parsedUrl = new URL(targetUrl);
        const allowedHosts = [
            'reddit.com', 'redditmedia.com', 'redd.it',
            'redgifs.com', 'media.redgifs.com', 'v3.redgifs.com', 'thumbs2.redgifs.com',
            'imgur.com', 'i.imgur.com'
        ];
        const isAllowed = allowedHosts.some(host => parsedUrl.hostname === host || parsedUrl.hostname.endsWith('.' + host));
        if (!isAllowed) {
            console.warn(`[WARN] GET /api/proxy: Forbidden target host requested: ${parsedUrl.hostname}`);
            return res.status(403).json({ error: 'Forbidden target host' });
        }

        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            console.warn(`[WARN] GET /api/proxy: Fetch failed for target. Status: ${response.status}`);
            return res.status(response.status).json({ error: `Media provider returned HTTP ${response.status}` });
        }

        const contentType = response.headers.get('content-type') || '';
        res.setHeader('Content-Type', contentType);
        
        // Instruct Nginx proxy cache and browser cache to cache this resource for 7 days
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');

        const contentLength = response.headers.get('content-length');
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        const { Readable } = require('stream');
        Readable.fromWeb(response.body).pipe(res);
    } catch (err) {
        console.error('[ERROR] GET /api/proxy failed:', err);
        res.status(500).json({ error: err.message || 'Failed to fetch resource' });
    }
});

app.listen(PORT, () => {
    console.log(`[INFO] Server running on port ${PORT}`);
    console.log(`[INFO] Settings database: ${DB_FILE}`);
});
