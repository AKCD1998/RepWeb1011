# Render Migration 0022 Execution Report - 2026-04-08

## Objective

Apply `migrations/0022_incident_report_resolution_actions.sql` to `render-live` so the deployed incident corrective-action flow can use `incident_report_resolution_actions`.

## Context / initial problem

Before execution:

- `render-live` already had `incident_reports` and real live records such as `INC-000001`
- the corrective-action feature had already been deployed in code, but Render schema was still missing `incident_report_resolution_actions`
- backend guard would fail with `run migration 0022 first` until the schema existed

## Files inspected

- [server/.env](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/.env)
- [migrations/0022_incident_report_resolution_actions.sql](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/migrations/0022_incident_report_resolution_actions.sql)
- [scripts/db-migration-apply.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-migration-apply.mjs)
- [scripts/db-migration-status.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-migration-status.mjs)
- [docs/render-migration-0022-runbook-20260408.md](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/docs/render-migration-0022-runbook-20260408.md)

## Files changed

- [docs/render-migration-0022-execution-20260408.md](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/docs/render-migration-0022-execution-20260408.md)

## What was changed

Production change executed on `render-live`:

- ran pre-check:

```powershell
npm run db:prod:status:0022
```

- confirmed status was `PENDING`
- ran production migration:

```powershell
npm run db:prod:apply:0022 -- --execute --allow-remote
```

- `psql` applied the migration successfully:
  - `BEGIN`
  - `CREATE TABLE`
  - `CREATE INDEX` x3
  - `COMMENT` x2
  - `COMMIT`
- ran post-check:

```powershell
npm run db:prod:status:0022
```

- confirmed status is now `APPLIED`
- ran sanity check against Render:
  - `INC-000001` still exists
  - `incident_report_resolution_actions` now exists
  - `action_type` column exists
  - `idx_incident_report_resolution_actions_incident_line` exists

## What was intentionally not changed

- no other migration was applied
- no rollback/down migration was attempted
- no local-simulation migration was run
- no row-level backfill into `incident_report_resolution_actions` was attempted
- no code changes were deployed from this task alone

## Problems encountered

- one sanity query was first launched in parallel with the apply step, so it read before the migration commit completed and temporarily reported the new table as missing
- this was resolved by re-running verification sequentially after the migration finished

## Open questions / risks

- schema is now ready on Render, but the app still needs the matching backend/frontend deployment if that code is not already live on Render
- local-simulation is still behind Render in some schema areas according to [docs/schema-diff-render-vs-localsim-20260408.md](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/docs/schema-diff-render-vs-localsim-20260408.md); this migration did not fix local parity
- if users already have a deployed frontend bundle cached, they may need a refresh before the new UI behavior is visible

## Exact next recommended step

Deploy or confirm deployment of the backend/frontend build that uses `incident_report_resolution_actions`, then test one real Render incident flow end-to-end:

1. open `Incident Reports` on Render
2. choose an incident such as `INC-000001`
3. create one corrective action
4. verify the action saves without the old schema-missing error
5. verify the resulting stock/dispense reference is traceable back to the incident
