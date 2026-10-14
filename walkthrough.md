# Walkthrough - Security Hardening, Error Logging & Credential Hygiene (v1.2.5)

## 🛠️ Architecture & Security Updates

### 1. Zero-Credential Architecture & Secret Hygiene
*   **Decoupled Credentials**: Removed hardcoded `ohXpoqrZYub1kg` string literal from [server.js](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/server.js). The server now strictly reads credentials from `process.env.REDDIT_CLIENT_ID` and `process.env.REDDIT_CLIENT_SECRET`.
*   **Docker Compose & Template**: Updated [docker-compose.yml](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/docker-compose.yml) to pass `REDDIT_CLIENT_ID: ${REDDIT_CLIENT_ID:-ohXpoqrZYub1kg}`, maintaining zero-configuration anonymous access for container deployments while keeping source code clean.
*   **Git Protection**: Added `.env`, `.env.*`, `*.pem`, `*.key`, and `*.cert` to [.gitignore](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/.gitignore) (with `!.env.example` whitelisted) to prevent accidental commit of local credentials.
*   **Sanitized Errors**: Reddit OAuth token error handling now sanitizes responses to prevent leaking internal headers or credentials into log files.

### 2. Comprehensive Logging & Error Reporting
*   **HTTP Request / Error Logger**: Added middleware to [server.js](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/server.js) logging request method, route, HTTP status, latency, and client IP. All 4xx status codes are logged as `[WARN]` and 5xx as `[ERROR]`.
*   **Unified Startup & Migration Logs**: Standardized SQLite database migrations and startup diagnostics to use the structured `log.info` and `log.error` logger.
*   **Stream Error Guards**: Added `nodeStream.on('error')` and `res.on('close')` listeners to the Reddit API web stream to prevent silent resource leaks or unhandled stream aborts.
*   **Candidate Fetch & Cache Logs**: Replaced empty catch blocks in LRU cache pruning and ZIP downloads with explicit `log.warn` messages recording target URLs and error reasons.
*   **Client Error Ingestion (`POST /api/client-log`)**: Implemented endpoint in [server.js](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/server.js) and integrated client reporter in [public/index.html](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/public/index.html) (and [Reddit_Gallery.html](file:///c:/Users/dhovi/Desktop/Reddit%20Gallery/Reddit_Gallery.html)). Browser-side feed errors (HTTP 403, 404, 429), unhandled exceptions, and ZIP errors are now reported directly into Docker container logs with a 10-second duplicate throttle.

### 3. Security Best Practices & Hardening
*   **Vulnerability Remediation**: Ran `npm audit fix` to resolve 5 vulnerabilities across `body-parser`, `proxy-addr`, `qs`, and `brace-expansion`. `npm audit` now reports **0 vulnerabilities**.
*   **SSRF Protection**: Added protocol validation (`http:` / `https:` only; rejects `file:`, `data:`, `ftp:`) and blocked private IP ranges (`127.0.0.1`, `localhost`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`) on all proxy and download endpoints.
*   **Security Headers & Fingerprinting**: Disabled `X-Powered-By` header and configured `Content-Security-Policy` (CSP), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy`.
*   **In-Memory Rate Limiting**: Added sliding-window rate limiters on `/api/proxy` (180 req/min) and `/api/download-zip` (15 req/min) to prevent request flooding.
*   **Input Validation & DoS Protection**: Lowered global JSON body parser limit from 50MB to 2MB. Validated payload types in `POST /api/settings`. Enforced a maximum limit of 500 items per ZIP download request and sanitized filenames against path traversal.

---

## 🧪 Verification Results

| Test Case | Method | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **npm Dependency Audit** | `npm audit` | 0 vulnerabilities | `found 0 vulnerabilities` | ✅ Pass |
| **Code Credential Scan** | `git grep -i -E "(ohXpoqrZYub1kg|password|secret|apikey|api_key)"` | No hardcoded credentials in source code | Confirmed 0 secrets in `server.js` or frontend | ✅ Pass |
| **Git Ignore Verification** | `git check-ignore .env .env.local` | Both ignored; `.env.example` tracked | Both ignored; `.env.example` tracked | ✅ Pass |
| **Server Health & Headers** | `GET /api/health` | 200 OK; CSP, nosniff, SAMEORIGIN; no `X-Powered-By` | Verified: all headers present; `X-Powered-By` absent | ✅ Pass |
| **SSRF Protocol Guard** | `GET /api/proxy?url=file:///etc/passwd` | 400 Bad Request | 400 Bad Request, logged as `[WARN]` | ✅ Pass |
| **SSRF Host Guard** | `GET /api/proxy?url=https://disallowed-domain.org/image.png` | 403 Forbidden | 403 Forbidden, logged as `[WARN]` | ✅ Pass |
| **SSRF Private IP Block** | `GET /api/proxy?url=http://127.0.0.1:8080/internal` | 403 Forbidden | 403 Forbidden, logged as `[WARN]` | ✅ Pass |
| **Settings Validation** | `POST /api/settings` with invalid type | 400 Bad Request (`"subreddits" must be an array`) | 400 Bad Request, logged as `[WARN]` | ✅ Pass |
| **Client Error Ingestion** | `POST /api/client-log` with error payload | 200 OK; recorded in server logs | 200 OK; logged as `[ERROR] [CLIENT]` | ✅ Pass |
| **ZIP Download Item Limit** | `POST /api/download-zip` with 505 items | 400 Bad Request (max 500 limit) | 400 Bad Request, logged as `[WARN]` | ✅ Pass |
| **HTML Synchronization** | `fc.exe /b Reddit_Gallery.html public\index.html` | 0 differences | No differences encountered | ✅ Pass |
