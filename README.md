# Reddit Gallery 🖼️

A self-hosted, lightweight, and sleek Reddit image & video gallery designed for desktops, tablets, and dashboards. Run it on Docker Desktop or deploy it directly to your unRaid server.

---

## ✨ Features

*   **Persistent Custom Tag Settings**: Saves active subreddits, user accounts, custom presets, blocks, and favorites.
*   **100% Private Local Proxy**: Completely free from third-party public CORS proxies (`corsproxy.io`, `allorigins`) and image resizers (`wsrv.nl`). All traffic is routed directly through your own local server backend proxy (`/api/proxy`).
*   **Local Media & Thumbnail Caching**: Stores proxied preview thumbnails, high-res images, and video streams in the container's AppData directory. Future requests load instantly from local server storage, saving internet bandwidth.
*   **Automatic Cache Pruning (LRU)**: Implements an LRU (Least Recently Used) cache manager that automatically deletes oldest cached files when storage limits are reached.
*   **RedGIFs v3 CDN Support**: Integrates the updated HD/SD video URL naming scheme for smooth RedGIFs playback.
*   **Interactive Tag Error Warnings**: Feeds that fail (due to spelling typos like `higheelsnsfw` or private/banned subreddits like `classygals`) are highlighted in the top bar with red warning chips (⚠️) and clear descriptions inside the tag manager.
*   **Responsive Masonry Grid**: Mobile, desktop, and tablet-friendly gallery interface with infinite scrolling.
*   **Interactive Modal**: Media viewer with auto-play slideshow timer, loop video controls, and keyboard navigation (`Escape`, `ArrowLeft`, `ArrowRight`).

---

## ⚙️ Configuration & Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | The port the Node.js server listens on inside the container. | `3000` |
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
      - PORT=3000
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
3.  **(Optional) Add Cache Limit Config**:
    *   Click **Add another Path, Port, Variable, Label or Device** at the bottom.
    *   Set **Config Type** to `Variable`.
    *   Set **Name** to `Cache Limit (GB)`.
    *   Set **Key** to `CACHE_LIMIT_GB`.
    *   Set **Value** to your desired limit in GB (e.g., `5` for 5 GB).
    *   Click **Add**.
4.  Click **Apply** to deploy the container.

---

## 📂 File Layout

*   `server.js`: Express app serving static files, settings API, and CORS streaming/caching proxy.
*   `public/index.html`: Main frontend client with custom tag managers and interactive modal.
*   `data/settings.json`: File stored on the host containing your custom configurations.
*   `data/cache/`: Folder containing cached binary media files.
