# Reddit Gallery 🖼️

A self-hosted, lightweight, and sleek Reddit image & video gallery designed for desktops, tablets, and dashboards. Run it on Docker Desktop or deploy it directly to your unRaid server.

---

## ✨ Features

*   **Vite + React Component Architecture**: Modular, high-performance React UI utilizing compiled utility stylesheets (Tailwind) for optimal rendering speeds.
*   **Native SQLite Database**: Employs Node 22's built-in `node:sqlite` module for settings data, eliminating file corruption and resolving unRaid root permissions issues.
*   **Seamless Settings Migration**: Automatically migrates settings from any existing `settings.json` to the new SQLite database (`settings.db`) on startup.
*   **Nginx Reverse Proxy & Native Cache**: Integrates Nginx directly in the Docker container to serve static assets and cache media streams (`/api/proxy`) in native C code, maximizing transfer rates and caching performance.
*   **Permissions Mapping (PUID/PGID)**: Startup script dynamically adjusts volume directories' ownership to your unRaid UID/GID (e.g. `99:100` / `nobody:users`), resolving file lock/permission problems.
*   **RedGIFs v3 CDN Support**: Integrates the updated HD/SD video URL naming scheme for smooth RedGIFs playback.
*   **Interactive Tag Error Warnings**: Feeds that fail (due to spelling typos like `higheelsnsfw` or private/banned subreddits like `classygals`) are highlighted in the top bar with red warning chips (⚠️) and clear descriptions inside the tag manager.
*   **Responsive Masonry Grid**: Mobile, desktop, and tablet-friendly gallery interface with infinite scrolling.
*   **Interactive Modal**: Media viewer with auto-play slideshow timer, loop video controls, and keyboard navigation (`Escape`, `ArrowLeft`, `ArrowRight`).

---

## ⚙️ Configuration & Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PUID` | Host User ID to map container volumes for unRaid host file permission sync. | `99` (nobody) |
| `PGID` | Host Group ID to map container volumes for unRaid host file permission sync. | `100` (users) |
| `CACHE_LIMIT_GB` | The maximum storage size allocated for local media caching in Gigabytes. | `2` |

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
      - PUID=99          # Set to your unRaid user UID (nobody is 99)
      - PGID=100         # Set to your unRaid group GID (users is 100)
      - CACHE_LIMIT_GB=2  # Change this to set custom caching storage size in GB
```

Run command:
```bash
docker compose up -d
```

---

## 💾 unRaid Deployment Guidelines

To run this container on unRaid:

1.  Navigate to the **Docker** tab and click **Add Container**.
2.  Fill in the configuration details:
    *   **Name**: `reddit-gallery`
    *   **Repository**: `dhovin/reddit-gallery:latest` (or use versioned tag `dhovin/reddit-gallery:1.0.0`)
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

*   `server.js`: Node.js Express backend serving APIs and validating CORS proxy requests.
*   `nginx.conf`: Nginx web server configuration serving static React files and handling media file caching.
*   `entrypoint.sh`: Privilege dropping startup wrapper for PUID/PGID filesystem sync.
*   `src/`: Vite React frontend client files (components, styles, and logic).
*   `data/settings.db`: Local SQLite database storing custom configurations.
*   `data/cache/`: Folder containing cached binary media files.
