# Walkthrough - Reddit Gallery Docker & CI/CD Setup

## 🛠️ Architecture & Recent Updates

### 1. Frontend & Lightbox Media Handling (`public/index.html`)
*   **Single-Page Frontend**: Served directly from `public/index.html` by Express.
*   **RedGIFs Static Image & Video Support**:
    *   Distinguishes RedGIFs static images (`i.redgifs.com/i/<id>.jpg` and `redgifs.com/i/<id>`) from RedGIFs video streams (`media.redgifs.com` / `v3.redgifs.com` / `redgifs.com/watch/<id>`).
    *   Ensures `isMediaVideo()` and `updateModalContent()` render RedGIFs static images in an `<img>` element inside the lightbox modal rather than a `<video>` element, with automatic fallback to Reddit's high-resolution preview image.

### 2. Backend Server & Database (`server.js`)
*   **Automatic Anonymous Reddit OAuth**: Employs built-in installed-client OAuth authentication to query `oauth.reddit.com`, completely bypassing Reddit's aggressive 403 "Blocked by network security" WAF and 429 rate limit errors with zero user configuration required.
*   **Request Pacing**: Staggers Reddit API calls to ensure multiple subreddits loading concurrently do not trip API rate limits.
*   **Node 22 + SQLite (`node:sqlite`)**: Stores settings (`subreddits`, `blockedUsers`, `favorites`, `presets`) in `/app/data/settings.db` with automatic migration from legacy `settings.json`.
*   **Streaming Proxy & LRU Disk Cache (`/api/proxy`)**: Validates allowed media hosts (`reddit.com`, `redd.it`, `redditmedia.com`, `redgifs.com`, `imgur.com`), streams responses directly to the client while caching to `/app/data/cache`, and prunes oldest files when total size exceeds `CACHE_LIMIT_GB`.
*   **Zero-RAM Streaming ZIP Download (`/api/download-zip`)**: Uses `archiver` to stream media directly from local cache or remote hosts into a downloadable `.zip`.
*   **Healthcheck & Graceful Shutdown**: Exposes `/api/health` for Docker `HEALTHCHECK` monitoring and cleanly closes HTTP and SQLite connections on `SIGTERM`/`SIGINT`.

### 3. unRaid Permissions Mapping (`entrypoint.sh` & `Dockerfile`)
*   **`entrypoint.sh`**: Reads `PUID` and `PGID` from environment variables, updates the container's `node` user/group IDs to match unRaid (`99:100` / `nobody:users`), adjusts `/app/data` ownership, and drops root privileges via `su-exec`.

### 4. Automated Docker Builds (`.github/workflows/docker-publish.yml`)
*   **GitHub Actions CI/CD**: Automatically builds and pushes the Docker image on every push to `main` (and on manual workflow dispatch), tagging `:latest` and the version from `package.json`:
    *   Pushes to **GitHub Container Registry** (`ghcr.io/dhovin/reddit-gallery`) using the built-in `GITHUB_TOKEN`.
    *   Pushes to **Docker Hub** (`dhovin/reddit-gallery`) whenever `DOCKERHUB_TOKEN` (and optional `DOCKERHUB_USERNAME`) are configured in GitHub repository secrets.
*   **Manual Local Build & Push**:
    ```bash
    docker build -t dhovin/reddit-gallery:latest -t dhovin/reddit-gallery:1.2.4 .
    docker push dhovin/reddit-gallery:latest
    docker push dhovin/reddit-gallery:1.2.4
    ```
