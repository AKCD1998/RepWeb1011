# DB Strategy Cleanup Report - 2026-04-08

## What I found

- Runtime DB access is already single-target. [server/db/pool.js](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/db/pool.js) reads one `DATABASE_URL` and does not multiplex multiple PostgreSQL databases.
- Live truth is Render PostgreSQL. In this workspace, [server/.env](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/.env) points to Render, and Render already contains real incident data such as `INC-000001`.
- Render is missing `migrations/0022_incident_report_resolution_actions.sql`.
- Local simulation exists separately on `localhost:55433/rx1011_local` and is suitable for test/dev only.
- Repo docs and examples were inconsistent:
  - local simulation scripts loaded `server/.env` before simulation overrides, which made the live/local boundary harder to reason about
  - Docker docs/examples still referenced `55432`
  - local docs still described arbitrary existing local PostgreSQL usage without strongly marking it as legacy/manual
- `localhost:5433` exists outside the standard repo flow but was not clearly labeled as non-standard.

## What I changed

### Scripts and runtime clarity

- Updated [scripts/local-sim-env.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/local-sim-env.mjs):
  - local simulation now loads only `.env.local-simulation` files
  - default local port is now `55433`
  - local simulation refuses non-loopback DB hosts
  - non-standard local ports and DB names now emit warnings
  - local migration plan now includes `0019_product_lot_edit_audits.sql` and `0021_product_report_receive_unit_levels.sql`
- Updated [server/index.js](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/index.js) so local simulation can explicitly point the backend at `server/.env.local-simulation` instead of logging/appearing to use the live env file.
- Added a clarifying comment in [server/db/pool.js](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/db/pool.js) that each process uses one `DATABASE_URL`.
- Updated local scripts to surface the DB target and warnings:
  - [scripts/dev-mock.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/dev-mock.mjs)
  - [scripts/db-local-init.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-local-init.mjs)
  - [scripts/db-local-migrate.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-local-migrate.mjs)
  - [scripts/db-local-seed.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-local-seed.mjs)
- Added `npm run dev:local-sim` in [package.json](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/package.json) and kept `dev:mock` as a compatibility alias.

### Standard local endpoint

- Updated [docker-compose.local.yml](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/docker-compose.local.yml) to expose PostgreSQL on `55433` so Docker matches the repo-standard local simulation path.
- Updated env examples:
  - [server/.env.example](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/.env.example)
  - [server/.env.local-simulation.example](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/.env.local-simulation.example)
  - [.env.example](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/.env.example)
  - [.env.local-simulation.example](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/.env.local-simulation.example)
  - [.env.production.example](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/.env.production.example)

### Docs

- Updated [README.md](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/README.md) to describe:
  - Render PostgreSQL as the only live/prod/staging truth
  - `localhost:55433/rx1011_local` as the standard local simulation DB
  - `localhost:5433` as non-standard/legacy
  - manual production migration policy, including the current `0022` command
- Rewrote [LOCAL_SIMULATION_GUIDE.md](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/LOCAL_SIMULATION_GUIDE.md) around the new standard.

## What remains manual

- Production migration for Render is still manual by design. The current reviewed command is:

```powershell
psql $env:DATABASE_URL --set ON_ERROR_STOP=1 --file migrations/0022_incident_report_resolution_actions.sql
```

- After that migration is applied to Render, deploy the backend/frontend code that depends on it.
- Any developer who still depends on `localhost:5433` must opt into that setup intentionally and accept that it is outside the repo standard.

## Risks and open questions

- The migration directory still has duplicate numbers (`0010_*`, `0021_*`). The repo avoids auto-sorting today, but long-term migration automation remains risky until numbering is normalized.
- Existing untracked/ignored local env files may still contain older ports or credentials. Developers should refresh from the updated examples.
- This cleanup does not auto-migrate Render and does not remove any external local PostgreSQL installations. It only makes the intended path explicit and safer.
