# Reddit Gallery 🖼️

A self-hosted, lightweight, and sleek Reddit image & video gallery designed for desktops, tablets, and dashboards. Run it on Docker Desktop or deploy it directly to your unRaid server.

---

## ✨ Features

*   **Zero-Build Single-Page Frontend**: Fast, self-contained HTML/JS interface (`public/index.html`) styled with Tailwind CSS, requiring no complex client build step.
*   **Native SQLite Database**: Employs Node 22's built-in `node:sqlite` module for settings data (`settings.db`), eliminating file corruption and resolving unRaid root permission issues.
*   **Automatic Anonymous Reddit OAuth**: Employs built-in installed-client OAuth authentication to query `oauth.reddit.com`, completely bypassing Reddit's aggressive 403 "Blocked by network security" WAF and 429 rate limit errors with zero user configuration required.
*   **Seamless Settings Migration**: Automatically migrates settings from any existing `settings.json` to the SQLite database (`settings.db`) on startup.
*   **Streaming Media Proxy & Local LRU Cache**: Streams and caches media requests (`/api/proxy`) directly to disk (`/app/data/cache`) with automatic LRU cache pruning based on `CACHE_LIMIT_GB`.
*   **Zero-RAM Streaming ZIP Downloads**: Streams selected or all gallery media directly into a `.zip` archive (`/api/download-zip`) using `archiver` with local cache reuse.
*   **Permissions Mapping (PUID/PGID)**: Startup script (`entrypoint.sh`) dynamically adjusts volume directory ownership to your unRaid UID/GID (e.g. `99:100` / `nobody:users`).
*   **RedGIFs Video & Image Support**: Supports both RedGIFs v3 HD/SD video streams (`media.redgifs.com` / `v3.redgifs.com`) and RedGIFs static image posts (`i.redgifs.com` / `redgifs.com/i/`) with automatic Reddit preview fallback.
*   **Interactive Tag Error Warnings**: Feeds that fail (due to spelling typos or private/banned subreddits) are highlighted in the top bar with red warning chips (⚠️) and clear descriptions inside the tag manager.
*   **Responsive Grid & Lightbox Modal**: Mobile, desktop, and tablet-friendly gallery interface with infinite scrolling, auto-play slideshow timer, looping video controls, and keyboard navigation (`Escape`, `ArrowLeft`, `ArrowRight`).

---

## ⚙️ Configuration & Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Port the Express server listens on inside the container. | `3000` |
| `PUID` | Host User ID to map container volumes for unRaid host file permission sync. | `99` (nobody) |
| `PGID` | Host Group ID to map container volumes for unRaid host file permission sync. | `100` (users) |
| `CACHE_LIMIT_GB` | The maximum storage size allocated for local media caching in Gigabytes. | `2` |
| `REDDIT_CLIENT_ID` | *(Optional)* Custom Reddit API Client ID to override the built-in anonymous OAuth client. | `ohXpoqrZYub1kg` |
| `REDDIT_CLIENT_SECRET` | *(Optional)* Custom Reddit API Client Secret if using a registered script-type application. | `""` (empty) |

---

## 🚀 Docker Setup

### Using Docker Compose
Initialize and run the container locally:

```yaml
version: '3.8'

services:
  reddit-gallery:
    build: .
    container_name: reddit-gallery
    image: dhovin/reddit-gallery:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=3000
      - PUID=99          # Set to your unRaid user UID (nobody is 99)
      - PGID=100         # Set to your unRaid group GID (users is 100)
      - CACHE_LIMIT_GB=2 # Change this to set custom caching storage size in GB
      - NODE_ENV=production
```

Run command:
```bash
docker compose up -d
```

---

## 🔄 Building & Publishing Docker Images

### Automated GitHub Actions Workflow (`.github/workflows/docker-publish.yml`)
Every push to the `main` branch (or manual trigger via **Actions -> Build and Push Docker Image -> Run workflow**) automatically builds the Docker image and tags it with both `:latest` and the version in `package.json`:

1.  **GitHub Container Registry (GHCR)**: Pushes automatically to `ghcr.io/dhovin/reddit-gallery:latest` and `ghcr.io/dhovin/reddit-gallery:<version>` using the built-in `GITHUB_TOKEN` (no extra setup required).
2.  **Docker Hub (`dhovin/reddit-gallery`)**: To enable automatic pushes to Docker Hub from GitHub Actions, add the following secret in your GitHub repository under **Settings -> Secrets and variables -> Actions**:
    *   `DOCKERHUB_TOKEN`: A Docker Hub Personal Access Token (PAT) with Read/Write permissions.
    *   `DOCKERHUB_USERNAME` *(optional)*: Defaults to `dhovin` if omitted.

### Manual Local Build & Push
To build and push the image directly from your machine:

```bash
docker build -t dhovin/reddit-gallery:latest -t dhovin/reddit-gallery:1.2.3 .
docker push dhovin/reddit-gallery:latest
docker push dhovin/reddit-gallery:1.2.3
```

---

## 💾 unRaid Deployment Guidelines

To run this container on unRaid:

1.  Navigate to the **Docker** tab and click **Add Container**.
2.  Fill in the configuration details:
    *   **Name**: `reddit-gallery`
    *   **Repository**: `dhovin/reddit-gallery:latest` (or `ghcr.io/dhovin/reddit-gallery:latest`)
    *   **Network Type**: `Bridge`
    *   **Port Connection**: Host `3000` -> Container `3000`
    *   **Volume Mount**:
        *   **Container Path**: `/app/data`
        *   **Host Path**: `/mnt/user/appdata/reddit-gallery`
        *   **Access Mode**: `Read/Write`
3.  **Add Permissions Mapping (PUID & PGID)**:
    *   Click **Add another Path, Port, Variable, Label or Device** at the bottom.
    *   Add **PUID**: Config Type `Variable`, Name `PUID`, Key `PUID`, Value `99`.
    *   Add **PGID**: Config Type `Variable`, Name `PGID`, Key `PGID`, Value `100`.
4.  **(Optional) Add Cache Limit Config**:
    *   Add **Cache Limit (GB)**: Config Type `Variable`, Name `Cache Limit (GB)`, Key `CACHE_LIMIT_GB`, Value `2` (or your preferred size in GB).
5.  Click **Apply** to deploy the container.

---

## 🔒 Security & Privacy Recommendations

This application is designed specifically for **trusted private local networks** (LANs) and lacks built-in authentication layers. 

> [!WARNING]
> **Do not expose this container directly to the public internet** (e.g., via direct DMZ port forwarding). Doing so would allow anyone to modify your settings or abuse your local proxy.

To access your gallery securely from outside your home network, it is recommended to use:
*   **A Private VPN**: Set up **WireGuard** or **Tailscale** on your unRaid server to tunnel safely into your home network.
*   **An Authenticating Reverse Proxy**: Run a reverse proxy like **Nginx Proxy Manager**, **Traefik**, or **Caddy** integrated with an authentication provider (such as **Authelia**, **Authentik**, or **Cloudflare Tunnel Access**) to force a login screen before the traffic reaches this container.

---

## 📂 File Layout

*   `server.js`: Node.js 22 Express backend serving static files, SQLite settings API, `/api/health`, `/api/proxy` media caching stream, and `/api/download-zip`.
*   `public/index.html`: Single-page frontend gallery application.
*   `entrypoint.sh`: Privilege-dropping startup wrapper for PUID/PGID filesystem sync.
*   `.github/workflows/docker-publish.yml`: GitHub Actions CI/CD workflow for building and pushing Docker images.
*   `data/settings.db`: Local SQLite database storing custom configurations.
*   `data/cache/`: Folder containing cached binary media files and metadata.
