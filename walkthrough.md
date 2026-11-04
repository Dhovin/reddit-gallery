# Walkthrough - Reddit Subreddit 403 Network Security Fix (v1.2.6)

## 🛠️ Root Cause & Solution

### 1. Root Cause Analysis
* **Symptom**: When loading Reddit Gallery, browsing user profiles (`/user/:username/submitted.json`) worked normally, but browsing subreddits (such as `/r/stockings`, `/r/hungrybutts`, `/r/realgirls`, `/r/classysexy`, etc.) failed with `Remote returned HTTP 403` and HTML bodies containing `<body class=theme-beta>` ("You've been blocked by network security").
* **Discovery**: Reddit's edge network/WAF on `oauth.reddit.com` specifically flags and blocks direct path-based sort queries (`/r/{subreddit}/new.json` and `/r/{subreddit}/rising.json`) with automated network security blocks. In contrast, queries using standard parameter sorting (`/r/{subreddit}.json?sort=new` and `/r/{subreddit}.json?sort=rising`) are officially supported, fully authenticated, and return clean `200 OK` JSON responses. User profile feeds were unaffected because their sort was already provided as a query parameter (`?sort=${sortBase}`).

### 2. Implemented Fixes
* **Server-Side API Normalization ([server.js](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/server.js))**:
  * Added transparent path rewriting for Reddit API requests: any request matching `/r/{subreddit}/(new|rising|hot|top|controversial).json` is automatically transformed into `https://oauth.reddit.com/r/{subreddit}.json` with the sort parameter preserved via `apiUrl.searchParams.set('sort', sort)`.
  * Normalized bare `/r/{subreddit}` paths to `/r/{subreddit}.json`.
  * Added explicit `Accept: application/json` header to all outgoing Reddit OAuth API calls.
  * Cleaned up empty query parameters (such as `after=`).
* **Frontend Feed Query Standardization ([Reddit_Gallery.html](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/Reddit_Gallery.html) & [public/index.html](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/public/index.html))**:
  * Updated subreddit feed URL construction from `https://www.reddit.com/r/${item.name}/${sortBase}.json?...` to `https://www.reddit.com/r/${item.name}.json?...&sort=${sortBase}`, harmonizing subreddit query format with user profile queries.
* **Version Bump**: Bumped version to `v1.2.6` in [package.json](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/package.json).

---

## 🧪 Verification Results

| Test Case | Method | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Subreddit Feed (Old URL shape)** | `GET /api/proxy?url=.../r/stockings/new.json` | 200 OK (rewritten to `.json?sort=new`), valid posts | `200 OK`, 5 posts received | ✅ Pass |
| **Subreddit Feed (New URL shape)** | `GET /api/proxy?url=.../r/stockings.json?sort=new` | 200 OK, valid posts | `200 OK`, 5 posts received | ✅ Pass |
| **User Profile Feed** | `GET /api/proxy?url=.../user/spez/submitted.json?sort=new` | 200 OK, valid user posts | `200 OK`, 5 posts received | ✅ Pass |
| **Server Health** | `GET /api/health` | 200 OK, database healthy | `200 OK`, `db: ok` | ✅ Pass |
| **Multi-sort Verification** | `sort=hot`, `new`, `top`, `rising`, `controversial` | 200 OK across all sort modes | `200 OK` across all modes | ✅ Pass |
| **Target Subreddits Verification** | Test 8 failing subreddits from logs (`stockings`, `hungrybutts`, `realgirls`, `legalteens`, `classysexy`, `petite`, `PetiteGoneWild`, `panties`) | 200 OK for all 8 subreddits | `200 OK` for all 8 subreddits | ✅ Pass |
| **HTML Synchronization** | `fc.exe /b Reddit_Gallery.html public\index.html` | 0 differences | No differences encountered | ✅ Pass |
| **Credential Hygiene** | `git grep -i -E "(ohXpoqrZYub1kg)"` | No credentials in source files | 0 hardcoded secrets in source files | ✅ Pass |
