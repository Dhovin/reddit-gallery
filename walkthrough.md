# Walkthrough - Containerize Reddit Gallery

I have completed the tasks to containerize the Reddit Gallery application, establish persistent setting storage, create a local API proxy, and push the repository to GitHub.

---

## 🛠️ Changes Implemented

### 1. Frontend Refactoring (Vite + React)
*   **Vite Setup**: Added `vite.config.js`, `postcss.config.js`, and `tailwind.config.js` to build and compile static assets.
*   **React Components**: Split the codebase into clean components:
    *   `src/components/Header.jsx`: Manages header elements, presets, active chips, and custom lists.
    *   `src/components/Grid.jsx`: Implements a multi-column masonry grid layout with an infinite scroll intersection observer sentinel.
    *   `src/components/Card.jsx`: Manages individual card rendering, overlay hover titles, action links, and local image fallback failovers.
    *   `src/components/Modal.jsx`: Fullscreen media player, loops, slideshow timers, and key listeners (`ArrowLeft`/`Right`/`Escape`).
    *   `src/components/TagManager.jsx`: Tags selection and preset drawers with error warnings.
    *   `src/App.jsx`: Global state orchestrator.

### 2. Backend Server & Database Refactoring
*   **Node 22 + SQLite (`node:sqlite`)**: Refactored `server.js` to utilize Node 22's native experimental SQLite module. Settings (subreddits, blockedUsers, favorites, presets) are stored safely in `/app/data/settings.db`.
*   **Auto-Migration**: Added a startup checker that reads the legacy `settings.json`, migrates configurations into the new SQLite database, and renames the file to `settings.json.bak` to secure migration.
*   **Proxy Endpoint**: Refactored `/api/proxy` to validate request URLs against allowed hosts and stream media back setting standard cache-control headers.

### 3. Nginx Caching & Proxy Engine
*   **Nginx Configuration**: Added `nginx.conf` to serve built React files statically on port `3000` and proxy `/api/proxy` media requests to Node.js on port `3031`.
*   **High Performance Cache**: Configured Nginx `proxy_cache` on the `/api/proxy` endpoint, delegating image/video disk caching and LRU pruning to Nginx (C-based speeds), completely removing caching workload from the Node process.

### 4. unRaid Permissions Mapping & Dropping Root
*   **Created [entrypoint.sh](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/entrypoint.sh)**: A wrapper script that reads `PUID` and `PGID` from environment variables, edits the container's local `node` user credentials to match, runs `chown` on the data directories to fix host permissions for unRaid (`nobody:users`), and starts Nginx and Node.js using `su-exec` to drop privileges.
*   **Refactored [Dockerfile](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/Dockerfile)**: Multi-stage configuration building Vite files in stage 1, and compiling a slim Alpine final runner in stage 2 installing Nginx, su-exec, and shadow.

---

## 🧪 Verification Results

1.  **Vite Build**: Compiled client assets successfully into `dist/` (generating optimized JS/CSS bundles).
2.  **Docker Build & Run**: Built multi-stage Docker image and verified container starts up correctly.
3.  **Local settings DB**: SQLite initialized the `settings` database tables and successfully wrote settings to `/app/data/settings.db`.
4.  **Auto-Migration test**: Validated that `settings.json` is parsed, stored into the SQLite tables, and renamed to `.bak` at server boot.
5.  **Caching proxy test**: Opened browser Developer Tools and verified that subsequent proxy requests return `X-Cache-Status: HIT` from Nginx.

---

## 🚀 unRaid Deployment Steps

You can now set this up on your unRaid server:

1.  Navigate to unRaid's **Docker** tab and click **Add Container**.
2.  Fill out the configuration form:
    *   **Name**: `reddit-gallery`
    *   **Repository**: `dhovin/reddit-gallery:latest`
    *   **Network Type**: `Bridge`
    *   **Port Connection (Host:Container)**: `3000:3000`
    *   **Path Mapping (Host:Container)**:
        *   **Container Path**: `/app/data`
        *   **Host Path**: `/mnt/user/appdata/reddit-gallery`
        *   **Access Mode**: `Read/Write`
3.  **Add environment variables for Permissions Mapping**:
    *   Add **PUID**: Config Type `Variable`, Name `PUID`, Key `PUID`, Value `99` (nobody).
    *   Add **PGID**: Config Type `Variable`, Name `PGID`, Key `PGID`, Value `100` (users).
4.  **Add environment variable for Caching Limit**:
    *   Add **Cache Limit**: Config Type `Variable`, Name `Cache Limit (GB)`, Key `CACHE_LIMIT_GB`, Value `2` (sets maximum disk space for local media caching).
5.  Click **Apply** to pull the image and run the container.

---

## 💾 Server-Side Media Caching (Nginx)
Media requests routed through the proxy `/api/proxy` are cached by Nginx's native caching engine:
*   **How it works**: Media files are cached under `/app/data/cache/`. Future requests load instantly from Nginx cache, bypassing the Node backend entirely and speeding up video playback.
*   **Storage protection**: The cache is self-managed by Nginx using your configured `CACHE_LIMIT_GB` environment variable. Nginx handles LRU eviction natively.

---

## 🔒 Security Notice
* **LAN Only**: This application is meant to run in a private, trusted local network. Do not expose this port directly to the internet.
* **External Access**: If you wish to access the gallery remotely, use a secure VPN (like WireGuard or Tailscale) or route it through an authenticating reverse proxy (like Nginx Proxy Manager + Authelia).
