# Schema Diff: Render Live vs Local-Simulation - 2026-04-08

## Objective

Inventory the schema differences between:

- `render-live` PostgreSQL, the canonical live DB
- `local-simulation` PostgreSQL on `localhost:55433`, the standard test/dev DB

The immediate decision this task supports is whether Render can safely receive `0022_incident_report_resolution_actions.sql` as a standalone live migration.

## Context / initial problem

Initial assumptions before this inspection:

- Render already had `incident_reports` and live records such as `INC-000001`
- Render was believed to be missing `0022`
- local-simulation was believed to already have `0020` and `0022`

The risk was that we might incorrectly conclude the only meaningful schema gap was `0022`, when there could be other drift between environments.

## Files inspected

Repo workflow and env wiring:

- [package.json](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/package.json)
- [README.md](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/README.md)
- [LOCAL_SIMULATION_GUIDE.md](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/LOCAL_SIMULATION_GUIDE.md)
- [scripts/local-sim-env.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/local-sim-env.mjs)
- [scripts/db-migration-helpers.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-migration-helpers.mjs)
- [scripts/db-migration-manifest.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-migration-manifest.mjs)
- [server/.env](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/.env)
- [server/.env.local-simulation](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/.env.local-simulation)

Relevant migrations:

- [migrations/0018_admin_sql_query_audits.sql](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/migrations/0018_admin_sql_query_audits.sql)
- [migrations/0019_product_lot_edit_audits.sql](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/migrations/0019_product_lot_edit_audits.sql)
- [migrations/0020_admin_incident_reports.sql](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/migrations/0020_admin_incident_reports.sql)
- [migrations/0021_product_report_receive_unit_levels.sql](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/migrations/0021_product_report_receive_unit_levels.sql)
- [migrations/0022_incident_report_resolution_actions.sql](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/migrations/0022_incident_report_resolution_actions.sql)

## Files changed

- [scripts/db-schema-diff.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-schema-diff.mjs)
- [package.json](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/package.json)
- [README.md](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/README.md)
- [scripts/local-sim-env.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/local-sim-env.mjs)
- [docs/schema-diff-render-vs-localsim-20260408.md](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/docs/schema-diff-render-vs-localsim-20260408.md)

## What was changed

- Added a lightweight read-only schema comparison script that inspects tables, columns, indexes, constraints, and extensions
- Added npm commands for schema diff execution
- Added README guidance for the schema diff command
- Fixed the compare path so each DB connection is built from its own parsed URL and does not inherit the other DB's port implicitly
- Produced this report from direct read-only inspection of both DBs

## What was intentionally not changed

- No migration was applied to Render
- No migration was applied to local-simulation
- No schema object was created, altered, or dropped in either database
- No row-level reconciliation was attempted
- No fake migration history table was introduced

## Scope

This report compares schema objects only, not business data.

Compared object types:

- public-schema base tables
- columns on those tables
- indexes
- constraints
- extension presence

This report does not compare:

- row-level data, except for a few sanity-presence probes
- triggers, functions, procedures, views, grants, comments, or ownership
- migration execution history, because the repo has no migration tracking table such as `schema_migrations`

## Compared environments

- `render-live`
  - canonical live DB from [server/.env](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/.env)
  - Render PostgreSQL
- `local-simulation`
  - standard test/dev DB from [server/.env.local-simulation](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/.env.local-simulation)
  - `localhost:55433/rx1011_local`

Sanity checks observed during this comparison:

- Render has real incident data and schema objects such as `incident_reports`
- local-simulation does not contain the live incident records

## Methodology

Repo inspection:

- reviewed migration ordering in [scripts/local-sim-env.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/local-sim-env.mjs)
- reviewed the incident schema migrations:
  - [migrations/0019_product_lot_edit_audits.sql](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/migrations/0019_product_lot_edit_audits.sql)
  - [migrations/0020_admin_incident_reports.sql](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/migrations/0020_admin_incident_reports.sql)
  - [migrations/0021_product_report_receive_unit_levels.sql](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/migrations/0021_product_report_receive_unit_levels.sql)
  - [migrations/0022_incident_report_resolution_actions.sql](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/migrations/0022_incident_report_resolution_actions.sql)
- confirmed the repo still uses explicit/manual migration ordering and has no shared migration history table

Comparison approach:

- added a lightweight read-only compare tool at [scripts/db-schema-diff.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-schema-diff.mjs)
- used the npm alias [package.json](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/package.json) script:

```bash
npm run db:schema:diff:render-vs-localsim
```

The script compares:

- base tables from `pg_class`
- columns from `pg_attribute` + `pg_attrdef`
- indexes from `pg_indexes`
- constraints from `pg_constraint`
- installed extensions from `pg_extension`

## Problems encountered

- The first comparison attempt failed because the process had mixed env-derived port assumptions between the two DB targets
- Specifically, local-simulation env loading set `PGPORT=55433`, and a Render connection that should have used its own resolved port was accidentally affected by library fallback behavior
- This was fixed by building each pool from parsed URL parts rather than relying on raw `connectionString` only
- The inspection also disproved an earlier assumption: the actual `localhost:55433` database in this workspace does not currently have `0022`

## Confirmed differences

High-level summary from direct inspection:

- Render public table count: `28`
- local-simulation public table count: `26`
- shared-table column definition drift: `none confirmed`
- shared-table index definition drift: `none confirmed`
- shared-table constraint definition drift: `none confirmed`

That means the confirmed drift is about missing or extra objects, not mismatched definitions on common objects.

### Render-only objects

These objects exist on `render-live` but not on current `local-simulation`:

- `incident_reports`
- `incident_report_items`
- `product_lot_edit_audits`
- `products.report_receive_unit_level_id`
- `products_report_receive_unit_level_id_fkey`
- `idx_products_report_receive_unit_level_id`

Migration interpretation:

- `0019_product_lot_edit_audits.sql`: present on Render, missing on local-simulation
- `0020_admin_incident_reports.sql`: present on Render, missing on local-simulation
- `0021_product_report_receive_unit_levels.sql`: present on Render, missing on local-simulation

### Local-simulation-only objects

These objects exist on current `local-simulation` but not on `render-live`:

- `admin_sql_query_audits`
- related indexes:
  - `idx_admin_sql_query_audits_created_at`
  - `idx_admin_sql_query_audits_executed_by_created_at`

Migration interpretation:

- `0018_admin_sql_query_audits.sql`: present on local-simulation, missing on Render

### Missing on both compared environments

These `0022` objects are missing on both actual databases inspected:

- `incident_report_resolution_actions`
- its columns
- its indexes such as `idx_incident_report_resolution_actions_incident_line`
- its constraints

Migration interpretation:

- `0022_incident_report_resolution_actions.sql`: missing on both actual DBs compared in this run

Important note:

- This directly contradicts the earlier assumption that current `local-simulation` already had `0022`
- the actual `localhost:55433` database inspected in this repo snapshot does not have `0022`

### Key migration presence matrix

| Migration | Render live | local-simulation | Evidence |
|---|---|---|---|
| `0017_product_lot_allowed_unit_levels.sql` | Present | Present | `product_lot_allowed_unit_levels` exists on both |
| `0018_admin_sql_query_audits.sql` | Missing | Present | `admin_sql_query_audits` only in local-simulation |
| `0019_product_lot_edit_audits.sql` | Present | Missing | `product_lot_edit_audits` only in Render |
| `0020_admin_incident_reports.sql` | Present | Missing | `incident_reports` + `incident_report_items` only in Render |
| `0021_product_report_receive_unit_levels.sql` | Present | Missing | `products.report_receive_unit_level_id` only in Render |
| `0022_incident_report_resolution_actions.sql` | Missing | Missing | `incident_report_resolution_actions` missing on both |

## Likely differences

These are strong interpretations, but not all of them are directly provable from schema alone:

- current `local-simulation` is likely stale relative to the repo's intended local migration plan
  - reason: [scripts/local-sim-env.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/local-sim-env.mjs) now includes `0019`, `0020`, `0021_product_report_receive_unit_levels`, and `0022` in the pre-seed migration list
  - but the actual `localhost:55433` database inspected here is still missing those schema artifacts
- Render is likely ahead of local-simulation for the incident and receive-unit schema, not behind
- Render is likely behind local-simulation only for `0018_admin_sql_query_audits`
  - whether that omission is intentional or accidental needs a product/ops decision

## Unknowns requiring manual credentialed inspection

These items were not proven by the schema-only diff:

- whether data-only or repair migrations such as `0008`, `0011`, `0014`, and `0021_repair_corrupted_packaging_display_names.sql` were applied identically
- differences in:
  - views
  - functions/procedures
  - triggers
  - grants/permissions
  - comments
  - sequence ownership/default wiring beyond the inspected defaults
- exact historical migration order in each environment
  - the repo has no migration history table, so this cannot be reconstructed from repo tooling alone

## Recommendation: is Render safe to migrate with 0022 only?

For the specific incident corrective-action rollout on live Render:

- **Yes, Render appears safe to migrate with `0022` only**

Reasoning:

- Render already has the prerequisite incident tables from `0020`
- Render already has the related base application tables that `0022` references
- no conflicting shared-object definition drift was found on common tables, columns, indexes, or constraints
- `0022` is additive: it creates a new table, supporting indexes, and comments

Important boundary:

- **No, `0022` alone is not enough to make Render and local-simulation schema-equal**

If the goal is environment parity, additional follow-up is needed:

- decide whether Render should also receive `0018_admin_sql_query_audits.sql`
- rebuild or re-bootstrap local-simulation so it catches up on `0019`, `0020`, `0021_product_report_receive_unit_levels`, and `0022`

## Open questions / risks

- Why is the current `local-simulation` database behind the repo's intended migration plan even though the repo scripts now include `0019`, `0020`, `0021_product_report_receive_unit_levels`, and `0022`?
- Is `0018_admin_sql_query_audits.sql` intentionally absent from Render, or is that another live gap that should be addressed later?
- This report did not compare functions, triggers, views, grants, comments, or ownership, so non-table drift may still exist
- The repo still has no migration history table, so later forensic inspection of exactly when a DB received a migration remains limited

## Exact next recommended step

1. Apply `0022` to `render-live`, because Render already has the required incident prerequisites and this is the live blocker for corrective-action flows.
2. Verify immediately with `npm run db:prod:status:0022`.
3. After the live blocker is cleared, re-bootstrap or repair `local-simulation` so it catches up on `0019`, `0020`, `0021_product_report_receive_unit_levels`, and `0022`.

## Bottom line

If the immediate goal is:

- get the live incident corrective-action feature working on Render

then:

- applying `0022` to Render is the right next step

If the broader goal is:

- restore schema parity between `render-live` and `local-simulation`

then:

- `0022` is only part of the cleanup
- the current `localhost:55433` database must also be brought back in line with the repo's intended migration set
