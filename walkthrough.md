# Walkthrough - Containerize Reddit Gallery

I have completed the tasks to containerize the Reddit Gallery application, establish persistent setting storage, create a local API proxy, and push the repository to GitHub.

---

## 🛠️ Changes Implemented

### 1. Repository & Git Setup
* **Created [.gitignore](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/.gitignore)**: Configured it to ignore dependency folders (`node_modules/`) and local runtime data (`data/`), keeping settings private and lightweight.
* **Git Repository Initialization**: Initialized a local git repository on the `main` branch, staged all project files, and pushed the commit directly to your GitHub remote repository [Dhovin/reddit-gallery](https://github.com/Dhovin/reddit-gallery.git).

### 2. Node.js/Express Backend Server
* **Created [package.json](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/package.json)**: Declared the Express dependency and start scripts.
* **Created [server.js](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/server.js)**:
  * **Settings Endpoint**: Serves `GET /api/settings` and `POST /api/settings` which saves user configuration into a structured JSON file at `/app/data/settings.json`.
  * **Built-in CORS & Media Proxy**: Provides a `/api/proxy?url=...` endpoint. It forwards calls with a browser user-agent to bypass blocks, whitelist hosts (reddit, imgur, redgifs), streams video chunks, and caches files locally to disk under `/app/data/cache`.

### 3. Frontend Refactoring & Local Proxy Only
* **Moved and Refactored [public/index.html](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/public/index.html)**:
  * **Transparent Auto-Sync**: Automatically loads settings from the backend on load and syncs changes back via background POST calls.
  * **100% Private local-only Proxy**: Removed all references to external public CORS proxies (`corsproxy.io`, `allorigins`, `yacdn`, `thingproxy`).
  * **Full Thumbnail Caching**: Replaced `wsrv.nl` image resizing calls with local proxy routing. This keeps thumbnail fetching private and stores preview card images on your local disk cache for instant future loads.
  * **Interactive Tag Warnings**: Added front-end validation tracking. If a subreddit feed fails due to spelling typos (like `higheelsnsfw`) or private/banned states (like `classygals`), the tag chip renders in red with a warning icon (⚠️) and shows a description in the tag manager so you can prune it.

### 4. Dockerization
* **Created [Dockerfile](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/Dockerfile)**: Uses a lightweight `node:20-alpine` base image, copies required codebase files, defines the `/app/data` persistent storage volume, and exposes port `3000`.
* **Created [docker-compose.yml](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/docker-compose.yml)**: Configures container building, exposes port `3000`, maps local `./data` to `/app/data`, and exposes environment configuration like `CACHE_LIMIT_GB` for the LRU cache pruner.

---

## 🧪 Verification Results

1. **Local Server Verification**: Started the server on local host, verified endpoints returned correct default states.
2. **Settings Persistence Test**: Executed a `POST /api/settings` request to save active subreddits, which successfully generated a formatted `data/settings.json` file on the host.
3. **Docker Compose Run**: Successfully ran the containerized application. The settings saved in local test were correctly loaded from the mounted volume by the Docker container on startup.
4. **Git Repository Push**: Staged all assets and pushed code successfully to your GitHub repository `https://github.com/Dhovin/reddit-gallery.git`.

---

## 🚀 unRaid Deployment Steps

You can now set this up on your unRaid server using one of the following two paths:

### Option A: Using the Docker Compose Manager Plugin
*If you prefer using Docker Compose on unRaid:*
1. Copy the project files (specifically `docker-compose.yml`, `Dockerfile`, `server.js`, `package.json`, and `public/index.html`) to a directory on your unRaid flash/disk (e.g. `/mnt/user/appdata/reddit-gallery`).
2. Go to the **Docker** tab in unRaid, scroll to the bottom, and click **Add New Project** under the Docker Compose section.
3. Name it `reddit-gallery`, point it to the folder you created, and select **Build** and **Up**.

### Option B: Using the unRaid Native GUI Add Container
*If you prefer the standard unRaid web interface:*
1. On your desktop, build and push the Docker image to Docker Hub (or build it directly on unRaid via CLI):
   ```bash
   docker build -t dhovin/reddit-gallery:latest .
   docker push dhovin/reddit-gallery:latest
   ```
2. Navigate to unRaid's **Docker** tab and click **Add Container**.
3. Fill out the configuration form:
   * **Name**: `reddit-gallery`
   * **Repository**: `dhovin/reddit-gallery:latest`
   * **Network Type**: `Bridge`
   * **Port Connection (Host:Container)**: `3000:3000`
   * **Path Mapping (Host:Container)**:
     * **Container Path**: `/app/data`
     * **Host Path**: `/mnt/user/appdata/reddit-gallery`
     * **Access Mode**: `Read/Write`
4. Click **Apply** to pull the image and run the container.

---

## 💾 Server-Side Media Caching (LRU)
We have implemented a local media caching system on the server:
* **How it works**: Media requests routed through the proxy `/api/proxy` (which is used as the high-priority fallback for videos and images) are cached under `/app/data/cache/`. The next time you load the gallery, these images and videos stream directly from your unRaid server, cutting out external loading times entirely.
* **Storage Protection**: The cache is self-cleaning and implements an LRU (Least Recently Used) pruning policy. It checks the folder size on server startup and after every cache write.
* **Cache Limit Configuration**:
  * **Default limit**: `2 GB`.
  * **Custom Limit**: You can change this limit by adding a custom Environment Variable in your unRaid container template:
    * **Key**: `CACHE_LIMIT_GB`
    * **Value**: Number of gigabytes (e.g., `5` for 5 GB, `10` for 10 GB).
