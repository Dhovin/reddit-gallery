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
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            return res.json(JSON.parse(data));
        }
        res.json({});
    } catch (err) {
        console.error('Error reading settings file:', err);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

// Save settings
app.post('/api/settings', (req, res) => {
    try {
        const settings = req.body;
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        console.error('Error writing settings file:', err);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Built-in proxy to bypass CORS
app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
        // Validate target URL to prevent SSRF
        const parsedUrl = new URL(targetUrl);
        if (!parsedUrl.hostname.endsWith('reddit.com') && 
            !parsedUrl.hostname.endsWith('redditmedia.com') && 
            !parsedUrl.hostname.endsWith('redd.it')) {
            return res.status(403).json({ error: 'Forbidden target host' });
        }

        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 RedditGalleryDocker/1.0.0'
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `Reddit API returned HTTP ${response.status}` });
        }

        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('Proxy error:', err);
        res.status(500).json({ error: err.message || 'Failed to fetch' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
