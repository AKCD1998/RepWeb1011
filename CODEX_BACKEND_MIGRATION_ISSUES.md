# Codex Backend Migration Issues And Lessons

This note records the practical issues found while documenting, testing, and moving the `Rx1011` backend into the shared `currentSC-official-website-project` web service.

It is written as a handoff for future Codex skill/template creation.

## Repositories Involved

Source repo:

```text
C:\Users\scgro\Desktop\Webapp training project\Rx1011
```

Source app folder:

```text
C:\Users\scgro\Desktop\Webapp training project\Rx1011\REACTjs-Project
```

Target repo:

```text
C:\Users\scgro\Desktop\Webapp training project\currentSC-official-website-project
```

Production/static frontend:

```text
https://akcd1998.github.io/RepWeb1011/
```

Old standalone Rx1011 backend service:

```text
https://repweb1011.onrender.com
Render service: RepWeb1011
Render service id: srv-d72fdhdm5p6s73d0ns10
```

Shared currentSC backend service:

```text
https://sc-official-website.onrender.com
Render service: SC-official-website
Render service id: srv-d58idfm3jp1c73bhgv40
```

## Original Work Requested

Three work phases were requested:

1. Document the `Rx1011` backend structure in `BACKEND_STRUCTURE.md`.
2. Add lightweight backend baseline tests and document them in `BACKEND_TEST_BASELINE.md`.
3. Move/refactor the Rx1011 backend into `currentSC-official-website-project` under `/api/rx1011`, then document the migration in `RX1011_INTEGRATION_REPORT.md`.

Important constraints from the user:

- Do not refactor business logic during documentation.
- Do not delete source repo files.
- Do not deploy automatically.
- Do not run destructive migrations automatically.
- Do not hardcode secrets.
- Keep backend tests lightweight.
- Avoid real destructive database writes unless a safe test DB pattern exists.
- Preserve existing currentSC website routes.
- Namespace Rx1011 under `/api/rx1011`.

These constraints were correct, but they created some follow-on operational gaps that had to be handled carefully.

## High-Level Architecture Outcome

The safest integration structure was to copy the Rx1011 backend into the target backend as an isolated module:

```text
currentSC-official-website-project/
  backend/
    server.js
    src/
      modules/
        rx1011/
          index.js
          lazyRouter.cjs
          routes/
          controllers/
          middleware/
          db/
          migrations/
          data/
```

The target app mounts the module at:

```text
/api/rx1011
```

Examples:

```text
Old standalone route: /api/products
New shared route:     /api/rx1011/products

Old standalone route: /api/locations
New shared route:     /api/rx1011/locations

Old standalone route: /api/auth/login
New shared route:     /api/rx1011/auth/login
```

## Major Issues Found

### 1. Live Frontend Still Pointed At Old Render Backend

The most important issue was not the backend mount itself.

The live GitHub Pages frontend was still compiled with:

```text
https://repweb1011.onrender.com
```

This URL was baked into the Vite production bundle:

```text
https://akcd1998.github.io/RepWeb1011/assets/index-2jgVVm6z.js
```

That meant suspending the old `RepWeb1011` Render service immediately broke the GitHub Pages app, even though the shared currentSC backend was already working.

Root cause:

- Vite injects `VITE_*` variables at build time.
- Changing Render env vars later does not change an already-built GitHub Pages JavaScript bundle.
- The GitHub Pages workflow previously used repository variables:

```yaml
VITE_API_BASE: ${{ vars.VITE_API_BASE }}
VITE_API_PREFIX: ${{ vars.VITE_API_PREFIX }}
```

If `vars.VITE_API_BASE` still pointed to `https://repweb1011.onrender.com`, every new Pages build kept depending on the old service.

Fix applied:

The Pages workflow was changed to pin the build to the shared backend:

```yaml
VITE_API_BASE: https://sc-official-website.onrender.com
VITE_API_PREFIX: /api/rx1011
```

A guard was added so the Pages deploy fails if the generated bundle still contains:

```text
repweb1011.onrender.com
```

Verification:

The current live Pages app now serves:

```text
index-C08R3AAA.js
```

and that bundle contains:

```text
https://sc-official-website.onrender.com
/api/rx1011
```

It no longer contains:

```text
repweb1011.onrender.com
```

### 2. CORS Origin Was Confused With Full URL Path

The browser origin for GitHub Pages is:

```text
https://akcd1998.github.io
```

It is not:

```text
https://akcd1998.github.io/RepWeb1011
```

CORS checks only scheme + host + port, not the route path.

Correct CORS value:

```text
https://akcd1998.github.io
```

Incorrect CORS value:

```text
https://akcd1998.github.io/RepWeb1011
```

This caused confusion because the visible app URL includes `/RepWeb1011/#/...`, but the browser sends the origin header as only:

```http
Origin: https://akcd1998.github.io
```

Correct currentSC shared backend CORS behavior was verified with:

```text
OPTIONS https://sc-official-website.onrender.com/api/rx1011/locations?includeInactive=false
Origin: https://akcd1998.github.io
Access-Control-Request-Method: GET
Access-Control-Request-Headers: authorization,content-type
```

Expected result:

```text
204 No Content
access-control-allow-origin: https://akcd1998.github.io
access-control-allow-credentials: true
```

### 3. 401 Auth Errors Looked Like CORS Errors

Several frontend console messages looked like CORS failures, but direct HTTP testing showed that CORS was often already passing.

For example:

```text
GET /api/rx1011/locations?includeInactive=false
```

returns:

```json
{"error":"Missing or invalid Authorization header"}
```

with status:

```text
401 Unauthorized
```

That is expected for protected routes when no valid bearer token is sent.

Why this was confusing:

- Browser console often reports CORS-ish messages when a request fails before the app handles it cleanly.
- If the old service was suspended or returning `502`, Render's edge error response did not include app CORS headers, so the browser reported it as CORS.
- After CORS was fixed, the same endpoint correctly returned `401`, which meant auth was now the active issue.

Actionable distinction:

- `OPTIONS` fails with no `access-control-allow-origin`: CORS problem.
- `OPTIONS` succeeds but `GET` returns `401`: auth/session/token problem.
- Render returns `502`: service crash/suspend/cold/runtime problem, not necessarily app CORS.

### 4. Old Tokens May Not Work Against Shared Backend

The frontend stores auth values under local storage keys:

```text
rx1011_auth_token
rx1011_auth_user
```

If a user logged in when the frontend targeted:

```text
https://repweb1011.onrender.com
```

then later the frontend targets:

```text
https://sc-official-website.onrender.com/api/rx1011
```

the old token may fail if the JWT secret differs between services.

Observed env naming risk:

- Standalone service had variables such as `RX1011_AUTH_JWT_SECRET` and `AUTH_JWT_SECRET`.
- The copied Rx1011 code expects:

```js
process.env.RX1011_JWT_SECRET || process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET
```

It does not use:

```text
RX1011_AUTH_JWT_SECRET
```

Therefore, `RX1011_AUTH_JWT_SECRET` may be a stale or unused variable unless some other code references it.

Practical instruction after switching backend:

- Hard refresh the frontend.
- Clear old local storage if needed.
- Log in again against the shared backend.

### 5. Render Dashboard Service Confusion

There are two relevant Render services:

```text
RepWeb1011
SC-official-website
```

The user's target was to decommission:

```text
RepWeb1011
```

and use:

```text
SC-official-website
```

as the backend for the Rx1011 frontend.

The confusion came from looking at:

```text
https://dashboard.render.com/web/srv-d72fdhdm5p6s73d0ns10
```

and:

```text
https://dashboard.render.com/web/srv-d58idfm3jp1c73bhgv40
```

These are different web services.

Important mapping:

```text
srv-d72fdhdm5p6s73d0ns10 = RepWeb1011 standalone backend
srv-d58idfm3jp1c73bhgv40 = SC-official-website shared backend
```

The safe decommission test is:

1. Confirm live GitHub Pages bundle no longer references `repweb1011.onrender.com`.
2. Confirm live GitHub Pages bundle references `sc-official-website.onrender.com` and `/api/rx1011`.
3. Confirm shared backend CORS preflights pass.
4. Suspend, not delete, `RepWeb1011`.
5. Hard refresh or open incognito.
6. Log in again.
7. Test receiving, products, reports, auth-protected routes.

### 6. `render.yaml` Was Not The Active Fix For GitHub Pages

The source `Rx1011` repo contains:

```text
render.yaml
```

That Blueprint config describes a standalone Render backend:

```yaml
services:
  - type: web
    name: rx1011-api
    rootDir: REACTjs-Project
    healthCheckPath: /api/health
```

That is useful if keeping/deploying the standalone backend.

But it does not control the GitHub Pages frontend API target.

The GitHub Pages frontend target is controlled by Vite build variables in:

```text
.github/workflows/ci-cd.yml
```

The deployed JS bundle is the source of truth for what API the browser will call.

Deployment lesson:

- For Render backend deployment issues, inspect `render.yaml` and Render settings.
- For GitHub Pages frontend API URL issues, inspect GitHub Actions build env and the generated `dist/assets/*.js`.

### 7. `render.yaml` And Dashboard Settings Can Drift

The `Rx1011` source `render.yaml` said:

```yaml
name: rx1011-api
rootDir: REACTjs-Project
buildCommand: npm ci
startCommand: npm run start
healthCheckPath: /api/health
```

The actual existing Render service was named:

```text
RepWeb1011
```

This can happen when:

- A service was created manually before adding a Blueprint.
- A service was renamed in the Dashboard.
- A Blueprint file exists but is not the active source of truth.

Skill/template recommendation:

- Always compare repo `render.yaml` with the live Dashboard settings.
- Do not assume `render.yaml` is active just because it exists.
- Ask whether the service was created manually, through Blueprint, or through direct dashboard setup.

### 8. Health Check Path Was Missing On Shared Service

The shared currentSC Render service had:

```text
Health Check Path: blank
```

The service still ran correctly, but a better setting is:

```text
/api/health
```

This is not a blocker, but it helps Render detect failed app startup more accurately.

### 9. Build Command Difference

The shared currentSC Render service used:

```text
npm install
```

The more reproducible command is:

```text
npm ci
```

This is not a runtime blocker. It is a deployment hygiene issue.

### 10. ESM/CommonJS Compatibility Required A Lazy Bridge

The target currentSC backend is CommonJS:

```json
"type": "commonjs"
```

The Rx1011 backend code is ESM:

```js
import express from "express";
export function createRx1011Router() {}
```

To avoid a risky full conversion, a bridge file was used:

```text
backend/src/modules/rx1011/lazyRouter.cjs
```

This uses dynamic import so the CommonJS target server can mount the ESM Rx1011 router.

Risk:

- Errors inside the ESM import may appear at request time instead of server boot time.

Mitigation:

- Add import smoke tests.
- Add `/api/rx1011/health` checks.

### 11. Express 4 vs Express 5 Risk

The original Rx1011 backend used Express 4 patterns.

The target currentSC backend uses Express 5.

Most routes worked in smoke tests, but deeper behavior may differ around:

- route matching
- async error handling
- wildcard routes
- middleware behavior

Mitigation:

- Keep integration narrow.
- Preserve route/controller code.
- Add smoke tests for known baseline statuses.
- Add feature-level tests later for write flows.

### 12. Database Migrations Were Copied But Not Run

The source repo contains many migrations:

```text
REACTjs-Project/migrations/
```

They were copied into:

```text
backend/src/modules/rx1011/migrations/
```

but not run automatically.

Reasons:

- The migrations include duplicate numeric prefixes.
- One migration is a reference/example query file.
- Running migrations automatically against production could be destructive.
- The user explicitly said not to run destructive migrations automatically.

Known migration risks:

```text
0010_active_ingredients_name_en_uppercase_guard.sql
0010_seed_login_usernames_refresh.sql
0021_product_report_receive_unit_levels.sql
0021_repair_corrupted_packaging_display_names.sql
0003_ky1011_example_queries.sql
```

Skill/template recommendation:

- Never auto-run copied migrations during consolidation.
- Document them as manual review only.
- Require a curated migration plan before running against shared production DB.

### 13. Database URL Isolation Was Important

The shared currentSC backend already had a `DATABASE_URL` for the main website.

Rx1011 should not accidentally use the same DB unless intentionally configured.

Preferred variable:

```text
RX1011_DATABASE_URL
```

Fallback variable:

```text
DATABASE_URL
```

Risk:

- If `RX1011_DATABASE_URL` is missing, Rx1011 can fall back to the currentSC `DATABASE_URL`.
- That may point Rx1011 queries at the wrong database.

Mitigation:

- Set `RX1011_DATABASE_URL` explicitly on the shared currentSC Render service.
- Document it in env examples and migration reports.

### 14. CORS Middleware Placement Matters

In the shared currentSC backend, CORS is mounted for:

```js
app.use("/api", cors(...));
```

Rx1011 is mounted under:

```js
app.use("/api/rx1011", rx1011Routes);
```

This means `/api/rx1011/*` receives the `/api` CORS middleware first, which is correct.

If Rx1011 had been mounted outside `/api`, the existing CORS middleware would not apply.

Skill/template recommendation:

- Always verify middleware order and path prefix.
- Test with real `OPTIONS` preflight, not only `GET`.

### 15. Static GitHub Pages Cache Can Make The Issue Look Fixed Or Broken Late

GitHub Pages responses include cache headers such as:

```text
Cache-Control: max-age=600
```

That means a user can keep receiving an old JS bundle for several minutes.

Observed transition:

Old live asset:

```text
index-2jgVVm6z.js
```

Old API target:

```text
https://repweb1011.onrender.com
```

New live asset:

```text
index-C08R3AAA.js
```

New API target:

```text
https://sc-official-website.onrender.com
/api/rx1011
```

Mitigation:

- Hard refresh.
- Use incognito.
- Check the actual JS asset content with `curl` or browser devtools.
- Do not suspend the old backend until the live asset no longer contains the old URL.

## Baseline Tests And Documentation Issues

### Backend Structure Documentation

The backend structure documentation needed to capture:

- entry point
- routes
- controllers
- middleware
- db connection files
- migrations
- env vars
- package scripts
- API endpoints
- deployment files

Important lesson:

Documentation must explicitly separate:

- source standalone backend structure
- target shared backend structure
- frontend deployment configuration
- Render backend service configuration

Otherwise, future agents may modify the wrong repo or wrong service.

### Baseline Backend Tests

Tests were intentionally lightweight:

- server/app can start
- health endpoint
- routes respond without crashing
- protected routes return expected auth errors
- DB layer imports safely
- controllers import safely

This was appropriate because:

- no safe destructive production-like test DB was confirmed
- many routes perform DB writes
- migrations were not safe to auto-run
- the user explicitly requested no business logic changes

Limitation:

- Authenticated write flows were not fully verified.
- Deep business behavior was not validated.
- Database schema parity was assumed based on health and smoke tests.

### Integration Tests In Target Repo

The target integration tests confirmed:

- existing currentSC health routes still work
- currentSC auth/contact behavior still works
- Rx1011 module imports
- `/api/rx1011/health` is mounted
- `/api/rx1011/patients` CSV fallback works when DB missing
- protected Rx1011 routes return expected auth failures
- DB-backed public routes fail predictably without DB

This was enough for safe initial mounting, not enough for full production certification.

## Deployment Issues Seen

### Shared currentSC Render Service

Observed correct settings:

```text
Service: SC-official-website
Runtime: Node
Repo: AKCD1998/SC-official-website
Branch: main
Root Directory: backend
Build Command: npm install
Start Command: npm start
URL: https://sc-official-website.onrender.com
```

Observed live checks:

```text
GET /api/health -> 200
GET /api/rx1011/health -> 200, database ok
OPTIONS /api/rx1011/locations -> 204 with correct CORS
```

Recommended improvements:

```text
Health Check Path: /api/health
Build Command: npm ci
Ensure RX1011_JWT_SECRET exists if JWT isolation is desired
Ensure RX1011_DATABASE_URL exists and points to Rx1011 DB
```

### Old RepWeb1011 Render Service

Observed:

```text
Service: RepWeb1011
Repo: AKCD1998/RepWeb1011
Branch: main
URL: https://repweb1011.onrender.com
```

It was safe to suspend only after confirming the live GitHub Pages bundle switched to the shared backend.

Safe suspension criteria:

```text
Live GitHub Pages JS does not contain repweb1011.onrender.com
Live GitHub Pages JS contains sc-official-website.onrender.com
Live GitHub Pages JS contains /api/rx1011
Shared backend health passes
Shared backend CORS preflight passes
User can log in again against shared backend
```

## Recommended Future Skill Behaviors

### For Backend Structure Skill

The skill should:

- Detect source root and app root separately.
- Identify backend entry point and module system.
- List route/controller/middleware/db/migration files.
- List package scripts.
- List env vars from code, `.env.example`, README, and deployment files.
- Explicitly identify frontend build-time API variables.
- Explicitly identify live deployment files and whether they appear active or merely present.
- Produce risks and unknowns, not just file maps.

### For Baseline Test Skill

The skill should:

- Prefer import/smoke tests when DB writes are risky.
- Test auth-required routes for expected `401`/`403`, not fake success.
- Avoid migrations unless a safe test DB is confirmed.
- Add a clear test baseline doc.
- Document skipped routes and why.
- Capture current behavior before refactor, even if imperfect.

### For Shared Web Service Migration Skill

The skill should:

- Read the source docs first.
- Inspect the target backend structure before copying.
- Namespace the module under `/api/<project>`.
- Keep source code isolated under `src/modules/<project>`.
- Avoid deep refactors during initial migration.
- Merge dependencies conservatively.
- Add route mapping old to new.
- Add env var mapping and collision risks.
- Add rollback plan.
- Verify live frontend build target separately from backend deployment.

### For Render/Deployment Skill

The skill should:

- Use Render workflow for Render setup, logs, status, and service config.
- Never deploy automatically unless explicitly asked.
- Never reveal or hardcode secrets.
- Confirm whether Render MCP/CLI/Dashboard access is available.
- Compare Dashboard settings to `render.yaml`.
- Check actual live HTTP behavior with `curl`:
  - health
  - CORS preflight
  - protected route without token
  - login route with bad body
- For CORS issues, always test `OPTIONS` with:

```text
Origin
Access-Control-Request-Method
Access-Control-Request-Headers
```

- For GitHub Pages/Vite issues, inspect the live JS asset for baked URLs.

## Commands That Were Useful

Check live frontend asset:

```powershell
$index = Invoke-WebRequest -Uri 'https://akcd1998.github.io/RepWeb1011/' -UseBasicParsing
$asset = ([regex]::Match($index.Content, 'src="\.\/assets\/([^"]+\.js)"')).Groups[1].Value
$js = Invoke-WebRequest -Uri "https://akcd1998.github.io/RepWeb1011/assets/$asset" -UseBasicParsing
$js.Content -match 'repweb1011\.onrender\.com'
$js.Content -match 'sc-official-website\.onrender\.com'
$js.Content -match '/api/rx1011'
```

Check shared backend health:

```powershell
curl.exe -i "https://sc-official-website.onrender.com/api/rx1011/health" `
  -H "Origin: https://akcd1998.github.io"
```

Check CORS preflight:

```powershell
curl.exe -i -X OPTIONS "https://sc-official-website.onrender.com/api/rx1011/locations?includeInactive=false" `
  -H "Origin: https://akcd1998.github.io" `
  -H "Access-Control-Request-Method: GET" `
  -H "Access-Control-Request-Headers: authorization,content-type"
```

Check if built dist still points at old backend:

```powershell
rg "repweb1011\.onrender\.com" REACTjs-Project/dist
```

Build with shared backend target:

```powershell
$env:VITE_API_BASE = "https://sc-official-website.onrender.com"
$env:VITE_API_PREFIX = "/api/rx1011"
npm --prefix REACTjs-Project run build
```

## Final State After Fixes

Current desired state:

```text
GitHub Pages frontend:
https://akcd1998.github.io/RepWeb1011/

Backend used by frontend:
https://sc-official-website.onrender.com/api/rx1011

Old standalone backend:
https://repweb1011.onrender.com
Can be suspended after live bundle verification.
```

Live verification after workflow update:

```text
Live JS asset: index-C08R3AAA.js
Contains: sc-official-website.onrender.com
Contains: /api/rx1011
Does not contain: repweb1011.onrender.com
```

Therefore the old `RepWeb1011` Render service can be suspended as a test, but should not be deleted until user workflows have been manually verified after a hard refresh and fresh login.
