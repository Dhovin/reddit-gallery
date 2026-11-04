# Walkthrough - Auto-Drop on 404/Error & Non-Blocking API Dispatch Pacing (v1.2.10)

## 🛠️ Overview of Changes

### 1. Auto-Drop & Deactivate on 404 / Permanent Feed Errors
* **Root Problem**: When a subreddit or user feed returned an HTTP 404 (due to account suspension/ban, deletion, or typo), the item was flagged with an error badge but remained active in the user's `subreddits` array. Every time the feed refreshed, sorted, or hit infinite scroll, the gallery re-queried the dead feeds, causing unnecessary queue load and blocking healthy feeds from loading.
* **Solution**: In `fetchImages()`, whenever a source returns a 404 or permanent error:
  * Automatically sets `subObj.active = false`.
  * Calls `saveSources()` to persist the deactivated state into SQLite `settings.db`.
  * Marks `cursors[item.name] = null` and adds to `failedSubreddits`.
  * The source is instantly dropped from the active feed and chip row, and appears in the **Inactive** tab in the Manage Sources drawer with the `⚠️ Error (Private/Banned/Typo)` badge and direct `🔗` Reddit link. Users can clean them up anytime using the protected **"Clear Inactive"** button.

### 2. Non-Blocking Server Dispatch Pacer
* **Root Problem**: Outbound requests to `oauth.reddit.com` in `server.js` were previously locked behind a synchronous sequential promise chain (`redditApiQueue`). If an invalid or dead endpoint hung or took several seconds, all subsequent requests in line were blocked. This caused valid subreddits behind it to exceed the browser's 12-second abort timer and falsely fail.
* **Solution**: Replaced the sequential execution lock with an asynchronous **dispatch-time pacer** (`paceRedditApiRequest`). Requests are launched with guaranteed 250ms spacing between their *start times* to respect Reddit's rate limit, but run **concurrently**. A slow or dead endpoint no longer delays subsequent valid feeds.
* Reduced the Reddit API request timeout from 15s to 8s (`AbortSignal.timeout(8000)`) so dead connections fail fast.

### 3. Immediate Fast-Fail on Local Backend Errors
* In `fetchJsonWithFallback`, when the `local-backend` returns any HTTP error (400, 403, 404, 500, etc.), it immediately fast-fails and throws.
* Completely eliminated the 12-second secondary fallback attempts to `jsonp` and `direct` (which are blocked by Reddit anyway and only caused up to 24 seconds of wasted browser hanging per dead feed).

### 4. Comprehensive URL Extraction (`/u/`, `reddit.com/u/`, etc.)
* Updated `extractCleanSourceName` to handle `https://www.reddit.com/u/...`, `reddit.com/user/...`, `/u/...`, and `/user/...` seamlessly, preventing malformed paths from producing false 404s.

### 5. Version & Verification
* Bumped version to `1.2.10` in `package.json`.
* Verified byte-for-byte synchronization between `Reddit_Gallery.html` and `public/index.html` via `fc.exe /b`.

---

## 🧪 Verification Results

| Test Case | Method | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Non-Blocking Dispatch Pacer** | Launch 3 requests with Req 1 delayed 800ms | Req 2 dispatches at ~250ms and finishes *before* Req 1 | Req 2 finished at 314ms, Req 1 at 811ms | ✅ Pass |
| **Auto-Drop on 404** | Simulate 404 error on feed | Source deactivated (`active = false`), cursor `null` | Deactivated & recorded in `failedSubreddits` | ✅ Pass |
| **429 Rate Limit Preservation** | Simulate 429 response | Source remains active, countdown banner triggered | Preserved active state, no deactivation | ✅ Pass |
| **HTML Synchronization** | `fc.exe /b Reddit_Gallery.html public\index.html` | 0 byte differences | `FC: no differences encountered` | ✅ Pass |
| **Server Syntax Check** | `node --check server.js` | 0 syntax errors | Clean execution | ✅ Pass |
| **Package Version** | Inspect `package.json` | Version `1.2.10` | `1.2.10` | ✅ Pass |
