# Walkthrough - Reddit Subreddit 403 & Zero-Configuration Deployment Fix (v1.2.7)

## 🛠️ Root Cause & Solution

### 1. Root Cause Analysis
* **Subreddit 403 Error**: Reddit's edge network/WAF on `oauth.reddit.com` specifically blocked direct path-based sort queries (`/r/{subreddit}/new.json` and `/r/{subreddit}/rising.json`) with an HTTP 403 network security block. Queries using standard parameter sorting (`/r/{subreddit}.json?sort=new`) work cleanly.
* **unRaid / Docker Run Missing REDDIT_CLIENT_ID**: When deployed via unRaid docker templates or direct `docker run` (without Docker Compose), `REDDIT_CLIENT_ID` was not passed in the environment, causing `server.js` to throw `Error: REDDIT_CLIENT_ID environment variable is missing.` on proxy requests.

### 2. Implemented Fixes
* **Built-in Zero-Config Fallback ([server.js](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/server.js) & [Dockerfile](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/Dockerfile))**:
  * Set default fallback `REDDIT_DEFAULT_CLIENT_ID = 'ohXpoqrZYub1kg'` in `server.js` so unRaid, raw `docker run`, and local development require zero manual configuration.
  * Added `ENV REDDIT_CLIENT_ID=ohXpoqrZYub1kg` in `Dockerfile`.
  * Preserved full support for custom `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` via environment variables.
* **Server-Side API Normalization ([server.js](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/server.js))**:
  * Added transparent path rewriting for Reddit API requests: `/r/{subreddit}/(new|rising|hot|top|controversial).json` is automatically mapped to `/r/{subreddit}.json?sort={sort}`.
  * Normalized bare `/r/{subreddit}` paths to `/r/{subreddit}.json`.
  * Added `Accept: application/json` headers and stripped empty `after=` query parameters.
* **Frontend Feed Query Standardization ([Reddit_Gallery.html](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/Reddit_Gallery.html) & [public/index.html](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/public/index.html))**:
  * Updated subreddit feed URL construction to `https://www.reddit.com/r/${item.name}.json?...&sort=${sortBase}`.
* **Version Bump**: Bumped version to `v1.2.7` in [package.json](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/package.json).

---

## 🧪 Verification Results

| Test Case | Method | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Zero-Config Deployment** | Run `server.js` with NO environment variables | Acquires token and returns 200 OK | `200 OK`, token acquired, 2 posts returned | ✅ Pass |
| **Subreddit Feed (Legacy Path)** | `GET /api/proxy?url=.../r/stockings/new.json` | 200 OK (rewritten to `.json?sort=new`) | `200 OK`, 5 posts received | ✅ Pass |
| **Subreddit Feed (Modern Path)** | `GET /api/proxy?url=.../r/stockings.json?sort=new` | 200 OK | `200 OK`, 5 posts received | ✅ Pass |
| **User Profile Feed** | `GET /api/proxy?url=.../user/spez/submitted.json?sort=new` | 200 OK | `200 OK`, 5 posts received | ✅ Pass |
| **Server Health** | `GET /api/health` | 200 OK, database healthy | `200 OK`, `db: ok` | ✅ Pass |
| **HTML Synchronization** | `fc.exe /b Reddit_Gallery.html public\index.html` | 0 differences | No differences encountered | ✅ Pass |
