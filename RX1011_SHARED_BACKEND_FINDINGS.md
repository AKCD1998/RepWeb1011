# Rx1011 Shared Backend Findings

Date: 2026-07-06

Scope:
- Observed repo structure and deployment/runtime wiring only
- Did not change application code
- Did not inspect secret values inside local `.env` files

## Bottom line

Yes, this repo already uses a shared backend in at least one active path.

The clearest evidence is the GitHub Pages deployment workflow: it builds the frontend against `https://sc-official-website.onrender.com` and forces the API prefix to `/api/rx1011`. That means the deployed Pages frontend is intended to call a shared host, not only this repo's standalone backend.

At the same time, the repo still keeps its own backend for local development and optional standalone deployment. So the repo is not "shared-backend only"; it supports both modes.

## What I found

### 1) The React frontend is explicitly wired for shared-backend routing

Files:
- `REACTjs-Project/src/lib/authApi.js`
- `REACTjs-Project/src/utils/deliverApiBase.js`
- `REACTjs-Project/src/utils/deliverCache.js`

Findings:
- `authApi.js` reads `VITE_API_BASE` and `VITE_RX1011_API_PREFIX`.
- `authApi.js` rewrites requests from `/api/...` to a prefixed path through `withApiPrefix(...)`.
- If `VITE_RX1011_API_PREFIX=/api/rx1011`, then calls such as `/api/products` become `/api/rx1011/products`.
- `deliverCache.js` also uses `withApiPrefix(...)`, so even the places using raw `fetch()` still follow the same prefix logic.

Conclusion:
- Shared-backend support is not just documented. It is active in runtime request construction.

### 2) GitHub Pages deployment is pinned to the shared backend

File:
- `.github/workflows/ci-cd.yml`

Findings:
- The Pages build exports:
  - `VITE_API_BASE=https://sc-official-website.onrender.com`
  - `VITE_RX1011_API_PREFIX=/api/rx1011`
- The workflow then validates the built output and fails if:
  - `repweb1011.onrender.com` is still present
  - `sc-official-website.onrender.com` is missing
  - `/api/rx1011` is missing

Conclusion:
- This is strong evidence that the deployed Pages frontend is already expected to use the shared currentSC backend path.

### 3) Local development still defaults to this repo's own backend

Files:
- `REACTjs-Project/vite.config.js`
- `REACTjs-Project/README.md`
- `REACTjs-Project/package.json`

Findings:
- Vite proxies `/api` to `http://localhost:5050` by default.
- `npm run dev:full` runs the local backend from `server/index.js`.
- README documents local frontend env as:
  - `VITE_API_BASE=http://localhost:5050`
  - `VITE_RX1011_API_PREFIX=`

Conclusion:
- Local dev is still primarily a direct local-backend setup, not a forced shared-backend setup.

### 4) The repo contains its own backend and optional standalone deployment

Files:
- `REACTjs-Project/server/index.js`
- `REACTjs-Project/server/db/pool.js`
- `render.yaml`

Findings:
- The in-repo Express backend serves normal `/api/...` routes.
- `render.yaml` still defines a standalone Render web service named `rx1011-api`.
- `server/db/pool.js` uses `RX1011_DATABASE_URL` first, then `DATABASE_URL`.
- `server/db/pool.js` includes a comment saying the namespaced env vars are preferred when this backend shares a web service with another app.

Conclusion:
- The backend is prepared to coexist in a shared environment, but this repo still clearly owns and ships its own backend service too.

### 5) The shared path appears to be handled outside this repo's Express route table

File:
- `REACTjs-Project/server/index.js`

Findings:
- This backend mounts routes at `/api/auth`, `/api/products`, `/api/inventory`, and similar plain `/api/...` paths.
- I did not find this repo mounting routes directly under `/api/rx1011/...`.

Conclusion:
- The shared-backend behavior is most likely handled by upstream routing or another host/service layer, not by a route prefix implemented inside this Express app.

### 6) There is also older legacy backend wiring in the `Vanilla` app

Files:
- `Vanilla/scripts/api-base.js`
- `Vanilla/backend/src/server.js`

Findings:
- The older Vanilla frontend defaults production API traffic to `https://repweb1011-production.up.railway.app`.
- That looks like a separate legacy standalone backend path, not the newer shared currentSC path.

Conclusion:
- The repo contains more than one backend era:
  - newer React app: shared-backend aware
  - older Vanilla app: legacy standalone backend wiring

## Final assessment

If your question is "is this repo using shared backend anywhere yet?", my answer is:

- Yes for the deployed GitHub Pages frontend.
- Yes in frontend runtime design, because request building supports `VITE_RX1011_API_PREFIX=/api/rx1011`.
- No for default local development, which still targets the repo's own backend.
- Not fully inside the Express app itself, because the server routes here are still plain `/api/...` routes.

So the most accurate summary is:

This repo is already integrated with a shared backend at the frontend deployment layer, while still keeping its own local/standalone backend path.
