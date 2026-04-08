# Render Migration Runbook - 0022 Incident Resolution Actions

## Current known state

As of `2026-04-08`:

- Render PostgreSQL is the live source of truth for the deployed app
- Render already has `incident_reports` and real incident data such as `INC-000001`
- Render is missing `migrations/0022_incident_report_resolution_actions.sql`
- Local simulation already has `0022`, but that is a separate test/dev database only
- The repo does not have a migration history table such as `schema_migrations`
- Because there is no migration tracking table, migration state must be verified from the schema itself

## Why Render needs 0022

`0022_incident_report_resolution_actions.sql` adds the `incident_report_resolution_actions` table plus supporting indexes.

That table is required so an incident can record which corrective action was actually applied, including:

- stock-in corrections
- stock-out corrections
- retrospective dispense creation tied back to the original incident

Without `0022`, the deployed backend can still read/write `incident_reports`, but corrective-action flows will return the guarded error telling the operator to run migration `0022` first.

## Required env and credential assumptions

Before running anything:

- `psql` must be installed on the machine running the command
- `DATABASE_URL` must point to the intended Render PostgreSQL database
- or `server/.env` in this repo must contain the intended Render `DATABASE_URL`
- the operator must have DB credentials with permission to create tables, indexes, and comments in the target schema

Safety notes:

- do not point these commands at local simulation unless you intend to verify local only
- do not rely on local-sim state as proof of production state
- the production helper scripts are conservative: they only manage reviewed migrations with explicit schema probes, and `0022` is the current reviewed case

## Check current state first

From the repo root:

```powershell
npm run db:prod:status:0022
```

Expected pending shape before the migration:

- `incident_reports table: present`
- `incident_report_resolution_actions table: missing`
- final status: `PENDING`

What this command does:

- loads the production/live `DATABASE_URL`
- probes the live schema directly
- does not write anything
- does not invent migration tracking history

## Exact command to apply 0022 to Render

Recommended repo-assisted path:

```powershell
npm run db:prod:apply:0022 -- --execute --allow-remote
```

What this command does:

1. probes current state first
2. refuses to proceed if prerequisite `incident_reports` is missing
3. refuses to write to a remote DB unless `--allow-remote` is supplied
4. runs:

```powershell
psql $env:DATABASE_URL --set ON_ERROR_STOP=1 --file migrations/0022_incident_report_resolution_actions.sql
```

5. probes again to verify the schema now reports `APPLIED`

Direct manual path, if you want to bypass the repo helper:

```powershell
psql $env:DATABASE_URL --set ON_ERROR_STOP=1 --file migrations/0022_incident_report_resolution_actions.sql
```

## How to verify success

Run the status command again:

```powershell
npm run db:prod:status:0022
```

Expected applied shape after success:

- `incident_reports table: present`
- `incident_report_resolution_actions table: present`
- `action_type column: present`
- `applied_stock_movement_id column: present`
- `incident-line index: present`
- final status: `APPLIED`

Application-level verification:

- open the admin incident corrective-action flow in the deployed app
- the previous guard error about `run migration 0022 first` should no longer appear
- creating or applying a corrective action should now reach business validation instead of schema-missing failure

## Rollback or fallback notes

There is no automated down migration in this repo for `0022`.

Practical fallback guidance:

- `0022` is additive only: it creates a new table, new indexes, and comments
- safest fallback is usually:
  - keep the schema change in place
  - roll back the application code if needed
- if a true schema rollback is required, it must be manual and carefully reviewed
- do not drop the table manually if production has already started writing corrective-action rows, unless you have a data-preserving rollback plan

## Deploy sequencing notes

Recommended order:

1. verify current Render status with `npm run db:prod:status:0022`
2. apply `0022` to Render
3. verify Render now reports `APPLIED`
4. deploy the backend code that reads/writes `incident_report_resolution_actions`
5. deploy or refresh the frontend that exposes the corrective-action UI
6. verify one end-to-end corrective-action flow against Render

Why this order:

- applying the schema first is safe because `0022` is additive
- deploying backend/frontend before the migration can leave users hitting the guarded `run migration 0022 first` error

## Why local-sim having 0022 does not mean production has it

Local simulation and Render are separate PostgreSQL databases.

Key points:

- the app runtime uses one `DATABASE_URL` at a time
- local-sim scripts target `localhost:55433/rx1011_local`
- Render uses its own remote PostgreSQL instance
- this repo does not maintain a shared migration history table across environments

So even if local-sim already has:

- `incident_report_resolution_actions`
- passing local tests
- working corrective-action UI

that does not prove Render has the same schema. Render must be checked and migrated independently.
