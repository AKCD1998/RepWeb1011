# Local Simulation Guide

## Intent

This repo now treats PostgreSQL in two clear roles only:

- `render-live`: Render PostgreSQL via `DATABASE_URL`
- `local-simulation`: `localhost:55433/rx1011_local`

The app still uses a single `DATABASE_URL` at runtime in [server/db/pool.js](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/db/pool.js). What changes between environments is only which env file supplies that value.

## Standard local path

Standard `local-simulation` endpoint:

```env
DATABASE_URL=postgresql://rx1011:rx1011@localhost:55433/rx1011_local
```

Supporting files:

- [server/.env.local-simulation.example](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/.env.local-simulation.example)
- [.env.local-simulation.example](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/.env.local-simulation.example)
- [docker-compose.local.yml](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/docker-compose.local.yml)

Standard commands:

```powershell
docker compose -f docker-compose.local.yml up -d
npm run db:local-sim:bootstrap
npm run dev:local-sim
```

Notes:

- `npm run dev:mock` is only a backward-compatible alias for `npm run dev:local-sim`
- `npm run db:local:*` is only a backward-compatible alias for `npm run db:local-sim:*`
- local simulation scripts load `.env.local-simulation` and `server/.env.local-simulation` only
- local simulation scripts refuse non-loopback database hosts, so they cannot silently hit Render/live PostgreSQL

## Local script behavior

Shared env loading lives in [scripts/local-sim-env.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/local-sim-env.mjs).

Key rules:

- default local host = `localhost`
- default local port = `55433`
- default local database name = `rx1011_local`
- non-standard local ports such as `localhost:5433` are allowed only as legacy/manual overrides and produce warnings
- `migrations/0003_ky1011_example_queries.sql` remains reference-only and is never auto-run
- the repo has no shared migration history table, so local simulation state and Render production state must be checked independently

Local migration plan:

- pre-seed schema/data-safe migrations:
  - `0001`, `0002`, `0004`, `0005`, `0006`, `0007`, `0009`, both `0010_*`, `0012`, `0013`, `0015`, `0016`, `0017`, `0018`, `0019`, `0020`, `0021_product_report_receive_unit_levels`, `0022`
- post-catalog fix migrations:
  - `0008`, `0011`, `0014`, `0021_repair_corrupted_packaging_display_names`

That explicit order is intentional because the repo has duplicate migration numbers.

## Legacy and optional paths

These are no longer treated as first-class repo defaults:

- `legacy-local-5433`
  - usually `localhost:5433`
  - unknown/legacy local PostgreSQL
  - not assumed by scripts
  - only use if you intentionally maintain it and accept the warning
- older Docker examples on `55432`
  - legacy/retired local port, not the current docker default
  - current docker compose binds the standard `local-simulation` endpoint on `55433`
  - update old local env files before using the current workflow

## Live database reminder

Render PostgreSQL remains the only live database source of truth.

- [server/.env.example](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/.env.example) shows the live/prod/staging backend env shape
- when present, `server/.env` is the live-like backend env file shape used outside the local-simulation workflow
- production migrations stay manual and reviewable
- production status/apply helpers live in:
  - [scripts/db-migration-status.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-migration-status.mjs)
  - [scripts/db-migration-apply.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-migration-apply.mjs)

As of `2026-04-08`, the known manual production step is:

```powershell
psql $env:DATABASE_URL --set ON_ERROR_STOP=1 --file migrations/0022_incident_report_resolution_actions.sql
```

Run that only after confirming `DATABASE_URL` is the intended Render PostgreSQL target.
