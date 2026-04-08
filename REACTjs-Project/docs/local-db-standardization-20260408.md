# Local DB Standardization - 2026-04-08

## Chosen standard local DB

The repo-standard local database is:

- name: `local-simulation`
- endpoint: `localhost:55433/rx1011_local`
- purpose: local development, testing, seed/reset workflows, and migration rehearsal

Recommended commands:

```powershell
docker compose -f docker-compose.local.yml up -d
npm run db:local-sim:bootstrap
npm run dev:local-sim
```

Notes:

- Docker is optional, but if you use it, it should host the same standard `local-simulation` endpoint on `55433`
- testing migrations should go to `local-simulation`, not to `render-live`

## Live database

The live database is:

- name: `render-live`
- source of truth: Render PostgreSQL via `DATABASE_URL`
- purpose: deployed app data and real records such as `INC-000001`

This database must never be confused with local testing.

## Rejected or secondary options

- `legacy-local-5433`
  - status: legacy / optional / not part of the default workflow
  - reason: it exists outside the repo standard, has ambiguous ownership, and can mislead developers into thinking it is the main local DB
- old `localhost:55432`
  - status: legacy / retired port from older Docker examples
  - reason: it created a second-looking local path that did not match the repo-standard local endpoint
- Docker itself
  - status: optional
  - reason: Docker is only one way to host `local-simulation`; it is not meant to define a separate database identity anymore

## Why confusion happened

Confusion came from multiple overlapping signals:

- Render live already existed and had real production data
- local simulation existed on `55433`
- a separate local PostgreSQL service existed on `5433`
- older Docker examples still pointed to `55432`
- older script/doc naming used generic `db:local:*`, which did not make the chosen standard obvious at a glance

So developers could easily walk away thinking there were several equally valid local or semi-live PostgreSQL targets.

## What changed to prevent this happening again

- standardized the repo language around two named roles:
  - `render-live`
  - `local-simulation`
- added `db:local-sim:*` npm commands and kept `db:local:*` only as backward-compatible aliases
- updated local script output to use `db:local-sim:*` labels
- kept local simulation isolated to `.env.local-simulation` files
- kept local simulation guarded against non-loopback database hosts
- updated env examples to label:
  - `render-live`
  - `local-simulation`
  - `legacy-local-5433`
  - old `55432` as legacy
- updated `docker-compose.local.yml` comments so Docker is clearly an optional host for the standard local DB, not a separate standard
- added quick-answer documentation in [README.md](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/README.md)

## Instant answers for future developers

- What DB should I use for local dev?
  - `local-simulation` at `localhost:55433/rx1011_local`
- What DB should I use for live?
  - `render-live` via `DATABASE_URL`
- Which DB should receive migrations during testing?
  - `local-simulation`
- Which DB should never be confused with production?
  - `local-simulation`, `legacy-local-5433`, and any old `55432` setup
