# Backend Structure

Last inspected: 2026-05-09

This document describes the backend-related structure in this repository. It is documentation only; no runtime behavior has been changed.

## High-Level Backend Architecture

The primary backend is the Express API inside `REACTjs-Project/server`.

```text
React/Vite client
  -> HTTP /api requests
  -> REACTjs-Project/server/index.js
  -> Express route files in server/routes
  -> controller functions in server/controllers
  -> PostgreSQL through server/db/pool.js
```

Important characteristics:

- Runtime is Node ESM (`"type": "module"` in `REACTjs-Project/package.json`).
- The API server entry point is `REACTjs-Project/server/index.js`.
- The backend uses `express`, `cors`, `dotenv`, `pg`, `jsonwebtoken`, and `bcrypt`.
- Database access is centralized through a single PostgreSQL `Pool` in `REACTjs-Project/server/db/pool.js`.
- Primary runtime env vars prefer the `RX1011_*` namespaced form so this backend can share a web service with another app without duplicate environment keys. Legacy unprefixed names remain fallback-compatible.
- Authentication uses JWT bearer tokens, role checks, token revocation via `revoked_tokens`, and branch scoping through `location_id`.
- Render deployment targets `REACTjs-Project` as the service root and starts the same server entry point through `npm run start`.

There is also an older or separate backend under `Vanilla/backend`. It is a monolithic Express server with inline route handlers and a different product-oriented schema. Treat it as legacy unless the project intentionally keeps both APIs.

## Backend Folder/File Map

### Primary backend: `REACTjs-Project/server`

```text
REACTjs-Project/server/
  index.js                         Express app, env loading, CORS, JSON parser, route mounting, health check
  db/
    pool.js                        PostgreSQL Pool, query helpers, transactions, health check
  middleware/
    authMiddleware.js              JWT verification, role authorization, branch access enforcement
  routes/
    activeIngredientsRoutes.js     /api/active-ingredients
    adminRoutes.js                 /api/admin/*
    authRoutes.js                  /api/auth/*
    dispenseRoutes.js              /api/dispense/*
    inventoryRoutes.js             /api/inventory/*
    productsRoutes.js              /api/products/*
    reportingRoutes.js             /api/stock, /api/movements, /api/reports, etc.
  controllers/
    adminController.js             DB schema browser, table rows, guarded SQL executor
    adminIncidentsController.js    Incident report CRUD, status, resolution, delete/audit behavior
    adminPatientsController.js     Admin patient listing
    authController.js              Login/logout, JWT creation, revoked token insertion
    dispenseController.js          Dispense creation and dispense history queries
    helpers.js                     Shared product, unit, lot, patient, branch, and stock helpers
    incidentResolutionHelpers.js   Incident resolution action normalization/application
    inventoryController.js         Receive, transfer, movement, stock, location, transfer request APIs
    organicReportsController.js    Organic dispense ledger reports
    productsController.js          Product catalog, units, lots, report groups, active ingredients
  scripts/
    importProductsFromXlsx.mjs     Product import utility
  utils/
    asyncHandler.js                Express async error wrapper
    dateOnly.js                    Date parsing/display helpers
    httpError.js                   HTTP error helper
```

Environment files exist in both project and server scopes:

```text
REACTjs-Project/.env
REACTjs-Project/.env.example
REACTjs-Project/.env.local-simulation
REACTjs-Project/.env.local-simulation.example
REACTjs-Project/.env.production.example
REACTjs-Project/server/.env
REACTjs-Project/server/.env.example
REACTjs-Project/server/.env.local-simulation
REACTjs-Project/server/.env.local-simulation.example
```

The real `.env` file contents are intentionally not documented here.

### Primary migrations and backend scripts

```text
REACTjs-Project/migrations/        SQL schema, seed/reference, audit, and corrective migrations
REACTjs-Project/scripts/           Local simulation, migration, audit, export, and syntax-check scripts
REACTjs-Project/docker-compose.local.yml
                                  Local PostgreSQL service for the standard local simulation DB
```

Key migration and database scripts:

- `scripts/local-sim-env.mjs`: loads local simulation env and defines explicit migration order.
- `scripts/db-local-init.mjs`: creates the local simulation database if needed.
- `scripts/db-local-migrate.mjs`: applies the curated local migration plan with `psql`.
- `scripts/db-local-seed.mjs`: truncates and seeds simulation data.
- `scripts/db-migration-status.mjs`: probes supported managed migrations.
- `scripts/db-migration-apply.mjs`: applies supported managed migrations with explicit remote guards.
- `scripts/db-migration-manifest.mjs`: schema-probe definitions for selected migrations.
- `scripts/db-schema-diff.mjs`: compares schema objects between configured profiles.
- `scripts/check-server-syntax.mjs`: backend syntax check used by CI.

### Legacy backend: `Vanilla/backend`

```text
Vanilla/backend/
  package.json                     Express 5 backend scripts/dependencies
  .env.example                     Example legacy backend env vars
  sql/
    schema.sql                     Legacy products table schema
  src/
    server.js                      Monolithic Express app with inline routes
    db.js                          PostgreSQL Pool
```

The legacy backend exposes product lookup/edit endpoints and optional static frontend serving. It does not share the primary backend's route/controller/middleware structure or current KY1011 schema.

## Server Entry Points

Primary:

- `REACTjs-Project/server/index.js`
- Started by `npm run server` and `npm run start` from `REACTjs-Project/package.json`.
- Default port: `5050`.
- Health check: `GET /api/health`.

Legacy:

- `Vanilla/backend/src/server.js`
- Started by `npm run dev` or `npm run start` from `Vanilla/backend/package.json`.
- Default port: `3001`.
- Health check: `GET /health`.

## Route Files

Primary route files:

- `server/routes/authRoutes.js`
- `server/routes/adminRoutes.js`
- `server/routes/productsRoutes.js`
- `server/routes/activeIngredientsRoutes.js`
- `server/routes/inventoryRoutes.js`
- `server/routes/dispenseRoutes.js`
- `server/routes/reportingRoutes.js`

Route mounting in `server/index.js`:

```text
/api/auth       -> authRoutes
/api/admin      -> adminRoutes
/api/products   -> productsRoutes
/api            -> activeIngredientsRoutes
/api/inventory  -> inventoryRoutes
/api/dispense   -> dispenseRoutes
/api            -> reportingRoutes
```

Primary route files are thin and delegate behavior to controllers. Authentication and role restrictions are applied at the route level.

## Controller Files

Primary controllers:

- `server/controllers/authController.js`
- `server/controllers/adminController.js`
- `server/controllers/adminIncidentsController.js`
- `server/controllers/adminPatientsController.js`
- `server/controllers/productsController.js`
- `server/controllers/inventoryController.js`
- `server/controllers/dispenseController.js`
- `server/controllers/organicReportsController.js`
- `server/controllers/helpers.js`
- `server/controllers/incidentResolutionHelpers.js`

The largest controller modules are `productsController.js` and `inventoryController.js`. They contain product catalog, unit-level, lot, stock, movement, and reporting behavior. `helpers.js` contains shared logic used by inventory, dispense, seeding, and product workflows.

## Middleware

Primary middleware:

- `server/middleware/authMiddleware.js`
  - `verifyToken(req, res, next)`: validates bearer JWTs, checks `revoked_tokens`, and sets `req.user`.
  - `requireRole(...roles)`: enforces roles and blocks `OPERATOR` write requests.
  - `requireBranchAccess(options)`: requires branch-scoped pharmacist/admin access and can match or force branch fields on body/query.

Utility middleware/helper:

- `server/utils/asyncHandler.js`: wraps async route handlers and forwards errors.
- `server/index.js`: includes CORS middleware, JSON body parsing, 404 handling, and centralized error handling.

## Database Connection Files

Primary:

- `REACTjs-Project/server/db/pool.js`
  - Reads `RX1011_DATABASE_URL`, falling back to `DATABASE_URL`.
  - Creates one `pg.Pool` when either database URL is present.
  - Uses SSL for non-localhost database URLs.
  - Exports `query`, `getClient`, `withTransaction`, `healthCheck`, and `hasDatabase`.

Legacy:

- `Vanilla/backend/src/db.js`
  - Reads `DATABASE_URL`.
  - Uses SSL when `DATABASE_SSL=true`, `DATABASE_SSL=1`, or `NODE_ENV=production`.

## API Endpoint List

### Core and Auth

| Method | Path | Auth | Controller/Handler |
|---|---|---|---|
| GET | `/api/health` | Public | Inline health check in `server/index.js` |
| GET | `/api/patients` | Public | Inline handler in `server/index.js`; DB first, CSV fallback |
| POST | `/api/auth/login` | Public | `login` |
| POST | `/api/auth/logout` | Bearer token | `logout` |

### Products and Reference Data

| Method | Path | Auth | Controller/Handler |
|---|---|---|---|
| GET | `/api/products` | Public | `listProducts` |
| GET | `/api/products/generic-names` | Public | `getGenericNames` |
| GET | `/api/products/unit-types` | Public | `getUnitTypes` |
| GET | `/api/products/report-groups` | Public | `getReportGroups` |
| GET | `/api/products/snapshot` | Public | `getProductsSnapshot` |
| GET | `/api/products/version` | Public | `getProductsVersion` |
| GET | `/api/products/:id/unit-levels` | Public | `getProductUnitLevels` |
| GET | `/api/products/:id/lot-whitelists` | Admin | `getProductLotWhitelists` |
| POST | `/api/products` | Admin | `createProduct` |
| PUT | `/api/products/:id` | Admin | `updateProduct` |
| PUT | `/api/products/:id/lots/:lotId/whitelist` | Admin | `updateProductLotWhitelist` |
| POST | `/api/products/:id/lots/normalize` | Admin | `normalizeProductLot` |
| PUT | `/api/products/:id/lots/:lotId/metadata` | Admin | `updateProductLotMetadata` |
| DELETE | `/api/products/:id` | Admin | `deleteProduct` |
| GET | `/api/active-ingredients` | Public | `getActiveIngredients` |

### Inventory and Stock

| Method | Path | Auth | Controller/Handler |
|---|---|---|---|
| POST | `/api/inventory/receive` | Admin/Pharmacist, branch-scoped | `receiveInventory` |
| POST | `/api/inventory/transfer` | Admin/Pharmacist, branch-scoped | `transferInventory` |
| POST | `/api/inventory/movements` | Admin/Pharmacist | `createMovement` |
| POST | `/api/inventory/movements/batch` | Admin/Pharmacist | `createMovementBatch` |
| GET | `/api/inventory/transfer-requests` | Admin/Pharmacist | `listTransferRequests` |
| POST | `/api/inventory/transfer-requests/:id/accept` | Admin/Pharmacist | `acceptTransferRequest` |
| POST | `/api/inventory/transfer-requests/:id/reject` | Admin/Pharmacist | `rejectTransferRequest` |
| PATCH | `/api/inventory/movements/:id/occurred-at-correction` | Admin | `updateMovementOccurredAtCorrection` |
| DELETE | `/api/inventory/movements/:id` | Admin | `deleteMovement` |
| GET | `/api/stock/on-hand` | Admin/Pharmacist/Operator | `getStockOnHand` |
| GET | `/api/stock/deliver-search-products` | Admin/Pharmacist/Operator | `getDeliverSearchProducts` |
| GET | `/api/movements` | Admin/Pharmacist/Operator | `getMovements` |
| GET | `/api/locations` | Admin/Pharmacist/Operator | `listLocations` |

### Dispense, Incidents, Reports, and Admin

| Method | Path | Auth | Controller/Handler |
|---|---|---|---|
| GET | `/api/dispense/history` | Admin/Pharmacist/Operator | `listDispenseHistory` |
| POST | `/api/dispense` | Admin/Pharmacist, branch-scoped | `createDispense` |
| GET | `/api/patients/:pid/dispense` | Public | `getPatientDispenseHistory` |
| GET | `/api/reports/organic-dispense-ledger/activity-products` | Admin/Pharmacist/Operator | `getOrganicDispenseLedgerActivityProducts` |
| GET | `/api/reports/organic-dispense-ledger` | Admin/Pharmacist/Operator | `getOrganicDispenseLedgerReport` |
| GET | `/api/incidents/:id` | Admin/Pharmacist/Operator | `getIncidentReportById` |
| GET | `/api/admin/patients` | Admin | `listAdminPatients` |
| GET | `/api/admin/incidents` | Admin | `listIncidentReports` |
| GET | `/api/admin/incidents/:id` | Admin | `getIncidentReportById` |
| POST | `/api/admin/incidents` | Admin | `createIncidentReport` |
| PATCH | `/api/admin/incidents/:id` | Admin | `updateIncidentReport` |
| POST | `/api/admin/incidents/:id/resolution` | Admin | `applyIncidentReportResolution` |
| PATCH | `/api/admin/incidents/:id/status` | Admin | `updateIncidentReportStatus` |
| DELETE | `/api/admin/incidents/:id` | Admin | `deleteIncidentReport` |
| GET | `/api/admin/db/schema` | Admin | `getDatabaseSchema` |
| GET | `/api/admin/db/tables/:tableName/rows` | Admin | `listTableRows` |
| POST | `/api/admin/sql/execute` | Admin | `executeSql` |

### Legacy Vanilla Backend Endpoints

`Vanilla/backend/src/server.js` defines these inline endpoints:

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Legacy DB health check |
| GET | `/api/products` | Lookup product by `barcode` |
| GET | `/api/products/list` | List products for DB edit table |
| GET | `/api/products/snapshot` | POS product prefetch snapshot |
| GET | `/api/products/version` | Product count/max id version string |
| GET | `/api/pack-sized` | List pack sizes |
| POST | `/api/pack-sized` | Create or update pack size |
| POST | `/api/products` | Create product |
| POST | `/api/products/:id/pack-sizes` | Replace product pack-size links |
| POST | `/api/products/:id/routes` | Replace product route links |
| POST | `/api/products/:id/reports` | Replace product report links |

## Database and Migration Summary

Primary database:

- PostgreSQL.
- Runtime connection is controlled by one database URL, preferring `RX1011_DATABASE_URL`.
- Local simulation standard database is `localhost:55433/rx1011_local`.
- Render/live database is expected to be supplied through `RX1011_DATABASE_URL` in shared-service deployments.

Primary schema starts in `REACTjs-Project/migrations/0001_ky1011_schema.sql`, which creates:

- Enum/reference domains for roles, locations, units, prices, movement types, etc.
- Core tables including `locations`, `users`, `patients`, `unit_types`, `dosage_forms`, `product_categories`, `active_ingredients`, `products`, `product_ingredients`, `product_unit_levels`, `product_unit_conversions`, `price_tiers`, `product_prices`, `product_lots`, `dispense_headers`, `dispense_lines`, `stock_movements`, `stock_on_hand`, and `dispensing_rules`.

Later migrations add or modify:

- Report groups and product report group links.
- Auth fields and `revoked_tokens`.
- Unit-level code stability and active/inactive support.
- Stock movement `quantity_base` single source of truth.
- Stock movement occurred-at correction audits.
- Pending inventory transfer requests.
- Product lot allowed unit levels and lot edit audits.
- Admin SQL query audits.
- Admin incident reports, incident report items, resolution actions, and admin audit trails.
- Product report receive unit-level support.
- Stock movement delete audits.
- Product lot normalization audits.
- Data repair/correction migrations for specific unit-level and packaging issues.

Migration files currently present:

```text
0001_ky1011_schema.sql
0002_ky1011_seed_reference.sql
0003_ky1011_example_queries.sql
0004_ky1011_report_groups.sql
0005_auth_fields.sql
0006_auth_revoked_tokens.sql
0007_unit_level_code_stability.sql
0008_fix_movement_unit_level_refs.sql
0009_stock_movements_quantity_base_ssot.sql
0010_active_ingredients_name_en_uppercase_guard.sql
0010_seed_login_usernames_refresh.sql
0011_fix_ic003358_prednisolone_unit_levels.sql
0012_stock_movement_occurred_at_corrections.sql
0013_backfill_stock_movement_occurred_at_from_created_at.sql
0014_fix_batch_blister_base_unit_levels.sql
0015_pending_transfer_requests.sql
0016_product_unit_levels_is_active.sql
0017_product_lot_allowed_unit_levels.sql
0018_admin_sql_query_audits.sql
0019_product_lot_edit_audits.sql
0020_admin_incident_reports.sql
0021_product_report_receive_unit_levels.sql
0021_repair_corrupted_packaging_display_names.sql
0022_incident_report_resolution_actions.sql
0023_stock_movement_delete_audits.sql
0024_incident_report_admin_audits.sql
0025_product_lot_normalization_audits.sql
```

Important migration behavior:

- There is no general migration history table such as `schema_migrations` in the repo.
- Migration state is inferred through schema probes for selected managed migrations.
- `0003_ky1011_example_queries.sql` is explicitly reference-only and should not be executed as a migration.
- Duplicate numeric prefixes exist (`0010_*` and `0021_*`), so filename sorting is not enough to determine safe migration order.
- Local simulation uses curated lists in `scripts/local-sim-env.mjs`:
  - `preSeedMigrations`
  - `postCatalogFixMigrations`
  - `referenceOnlyMigrations`
- Production/live migrations are intentionally manual. The helper scripts include remote safety gates and only support migrations with explicit manifest probes.

Legacy database:

- `Vanilla/backend/sql/schema.sql` creates a separate `products` table with JSONB fields for pack sizes, routes, and report types.
- This schema does not match the primary KY1011 normalized schema.

## Environment Variable Summary

### Primary backend runtime

| Variable | Used by | Purpose/default |
|---|---|---|
| `RX1011_SERVER_ENV_FILE` | `server/index.js` | Optional explicit env file path, resolved from `REACTjs-Project` when relative |
| `RX1011_DATABASE_URL` | `server/db/pool.js` | Preferred PostgreSQL connection string for shared-service deployments |
| `DATABASE_URL` | `server/db/pool.js` | Backward-compatible PostgreSQL connection string fallback |
| `PORT` | `server/index.js` | API port; defaults to `5050` |
| `RX1011_CORS_ORIGIN` | `server/index.js` | Preferred comma-separated allowed origins; defaults to `http://localhost:5173` |
| `CORS_ORIGIN` | `server/index.js` | Backward-compatible allowed origins fallback |
| `RX1011_PATIENTS_CSV_PATH` | `server/index.js` | Preferred optional CSV fallback path for `GET /api/patients` when DB is unavailable |
| `PATIENTS_CSV_PATH` | `server/index.js` | Backward-compatible CSV fallback path |
| `RX1011_JWT_SECRET` | `authController.js`, `authMiddleware.js` | Preferred JWT signing/verification secret |
| `JWT_SECRET` | `authController.js`, `authMiddleware.js` | Backward-compatible JWT signing/verification secret |
| `AUTH_JWT_SECRET` | `authController.js`, `authMiddleware.js` | Backward-compatible fallback for JWT secret |
| `ADMIN_SQL_EXECUTOR_MAX_SQL_LENGTH` | `adminController.js` | SQL editor max SQL length; default `20000` |
| `ADMIN_SQL_EXECUTOR_TIMEOUT_MS` | `adminController.js` | SQL statement timeout; default `5000` |
| `ADMIN_SQL_EXECUTOR_ROW_CAP` | `adminController.js` | SQL result row cap; default `200` |
| `ADMIN_TABLE_BROWSER_ROW_CAP` | `adminController.js` | Admin table browser row cap; default `500` |

Env loading order in `server/index.js`:

1. `RX1011_SERVER_ENV_FILE`, if set and the file exists.
2. `REACTjs-Project/server/.env`, if present.
3. `REACTjs-Project/.env`.

### Primary local simulation and migration scripts

| Variable | Used by | Purpose/default |
|---|---|---|
| `RX1011_DATABASE_URL` | Production migration/export scripts, backend runtime | Preferred connection string for the active production profile |
| `DATABASE_URL` | Migration, audit, export, local scripts | Local simulation and backward-compatible connection string fallback |
| `PGHOST` | `scripts/local-sim-env.mjs` | Local DB host; default `localhost` |
| `PGPORT` | `scripts/local-sim-env.mjs` | Local DB port; default `55433` |
| `PGUSER` | `scripts/local-sim-env.mjs` | Local DB user |
| `PGPASSWORD` | `scripts/local-sim-env.mjs` | Local DB password |
| `PGDATABASE` | `scripts/local-sim-env.mjs` | Local DB name; default `rx1011_local` |
| `PGSSLMODE` | `scripts/local-sim-env.mjs` | Optional SSL mode when building a DB URL from parts |
| `RX1011_ENV_PROFILE` | Set by `scripts/local-sim-env.mjs` | Set to `local-simulation` during local simulation |
| `RX1011_SERVER_ENV_FILE` | Set by `scripts/local-sim-env.mjs` | Points the backend at the local simulation env file |
| `VITE_PORT` | `scripts/dev-mock.mjs` | Optional frontend dev port display/control |

### Frontend/build variables that affect backend integration

| Variable | Used by | Purpose |
|---|---|---|
| `VITE_API_BASE` | Frontend API clients, GitHub Pages build | Deployed or local backend base URL |
| `VITE_API_BASE_URL` | Some frontend API helpers | Alternate backend base URL name |
| `VITE_API_PROXY_TARGET` | `vite.config.js` | Local Vite `/api` proxy target; defaults to `http://localhost:5050` |
| `VITE_API_KEY` | `Report1011Page.jsx`, GitHub Pages build | Frontend API key used by report page logic |
| `VITE_SMARTCARD_MQTT_URL` | `Deliver.jsx` | Smartcard MQTT-over-WebSocket URL |
| `VITE_SMARTCARD_MQTT_TOPIC` | `Deliver.jsx` | Smartcard MQTT topic |

### Render deployment variables

Defined or expected by `render.yaml`:

- `NODE_VERSION=20`
- `RX1011_DATABASE_URL` with `sync: false`
- `RX1011_JWT_SECRET` generated by Render
- `RX1011_CORS_ORIGIN` with `sync: false`

### Legacy backend variables

| Variable | Used by | Purpose/default |
|---|---|---|
| `DATABASE_URL` | `Vanilla/backend/src/db.js` | PostgreSQL connection string |
| `DATABASE_SSL` | `Vanilla/backend/src/db.js` | Enables SSL when `true` or `1` |
| `NODE_ENV` | `Vanilla/backend/src/db.js` | Enables SSL in `production` |
| `PORT` | `Vanilla/backend/src/server.js` | Legacy API port; defaults to `3001` |
| `SERVE_FRONTEND` | `Vanilla/backend/src/server.js` | Enables optional static frontend serving when `true` or `1` |

## Package Scripts

### `REACTjs-Project/package.json`

Runtime and development:

- `dev`: Vite frontend dev server.
- `dev:full`: starts backend and Vite concurrently.
- `dev:local-sim`: starts backend and Vite using the local simulation DB profile.
- `dev:mock`: alias for `dev:local-sim`.
- `server`: starts `server/index.js`.
- `start`: starts `server/index.js`.
- `build`: Vite production build.
- `preview`: Vite preview.

Database and migrations:

- `db:local-sim:init`
- `db:local-sim:migrate`
- `db:local-sim:seed`
- `db:local-sim:bootstrap`
- `db:local:init`
- `db:local:migrate`
- `db:local:seed`
- `db:local:bootstrap`
- `db:migration:status`
- `db:migration:apply`
- `db:prod:status:0022`
- `db:prod:apply:0022`
- `db:schema:diff`
- `db:schema:diff:render-vs-localsim`

Audits, exports, and checks:

- `audit:lot-whitelists`
- `audit:receiving-search`
- `audit:corrupted-packaging-labels`
- `audit:unit-levels`
- `export:fda-track-trace`
- `verify:unit-level`
- `check:server`
- `ci`: runs `check:server` and `build`.

### `Vanilla/backend/package.json`

- `dev`: `nodemon src/server.js`
- `start`: `node src/server.js`
- `test`: placeholder that exits with an error

## Current Deployment-Related Files

Primary deployment:

- `render.yaml`
  - Defines Render web service `rx1011-api`.
  - Uses Node runtime and branch `main`.
  - Uses `rootDir: REACTjs-Project`.
  - Build command: `npm ci`.
  - Start command: `npm run start`.
  - Health check path: `/api/health`.
  - Build filter covers server files, package files, `patients_rows.csv`, and `render.yaml`.

- `.github/workflows/ci-cd.yml`
  - Runs CI for changes under `REACTjs-Project`, the workflow file, or `render.yaml`.
  - Runs `npm ci` and `npm run ci` in `REACTjs-Project`.
  - Deploys the frontend `dist` folder to GitHub Pages on pushes to `main`.
  - Requires GitHub variable `VITE_API_BASE` for frontend deploy.
  - Uses GitHub secret `VITE_API_KEY` during frontend build.

Local deployment/simulation:

- `REACTjs-Project/docker-compose.local.yml`
  - Runs PostgreSQL `18-alpine`.
  - Container name: `rx1011-local-postgres`.
  - Host port: `55433`.
  - Database/user/password: `rx1011_local` / `rx1011` / `rx1011`.

Other deployment-adjacent files:

- `.clasp.json`
- `scripts/clasp-sheet-reader/appsscript.json`
- `scripts/clasp-sheet-reader/Code.js`

These files configure a Google Apps Script spreadsheet reader. They are not part of the Express API deployment path.

No `Dockerfile` was found in the repo during this inspection.

## Risks or Unclear Areas

- The repo contains two backend implementations with overlapping `/api/products` concepts. The primary Express API and the legacy Vanilla backend use different schemas and should not be merged blindly.
- Some actual `.env` files are present locally. `REACTjs-Project/.env` appears in `git ls-files`, and no repo-root `.gitignore` was found during inspection. Confirm secret hygiene before sharing, deploying, or migrating this repo.
- `GET /api/patients` and `GET /api/patients/:pid/dispense` are public in the primary backend. That may expose patient-related data unless intentionally protected elsewhere.
- `GET /api/health` returns `envPathUsed`, which can reveal filesystem layout. Consider reducing that before moving into a shared service.
- The admin SQL executor is restricted to read-style SQL, but it is still a high-risk admin capability that needs strict production controls, auditing, and service-level isolation.
- The migration set has duplicate numeric prefixes and one reference-only SQL file. Automated migration runners must use the curated migration plan, not simple lexical sorting.
- The repo does not have a general migration history table. Production status is inferred through schema probes for selected migrations only.
- Existing docs mention manual production/live migration policy. This inspection did not connect to Render/live PostgreSQL, so the actual production schema state was not verified.
- Branch scoping is enforced only on routes that explicitly apply `requireBranchAccess`; confirm every future write route chooses the correct branch policy.
- The primary backend has a CSV fallback for patients when no database URL is configured. That may be useful locally but is an unclear behavior for a shared production service.
- CI currently runs server syntax checks and frontend build, but there is no visible automated backend test suite for route/controller behavior.

## Notes for Future Migration Into a Shared Main Web Service

- Treat `REACTjs-Project/server` as the source backend unless there is a deliberate plan to preserve `Vanilla/backend`.
- Keep the existing route surface behind a namespace such as `/api/rx1011` or version it as `/api/v1` before placing it in a larger shared service.
- Convert this document's API table into an OpenAPI spec before integration. That will expose request/response contracts that are currently embedded in controllers.
- Centralize authentication with the main service's auth system. Map current roles (`ADMIN`, `PHARMACIST`, `OPERATOR`) and branch scoping (`location_id`) explicitly.
- Decide whether public patient and product endpoints remain public. Shared services usually need a default-auth posture with narrow public exceptions.
- Add a real migration history mechanism before automatic deployment migrations. Resolve duplicate migration numbering and keep reference-only SQL outside executable migration paths.
- Keep database ownership clear. The current backend assumes one PostgreSQL target per process and no multi-database routing.
- Move local simulation scripts into a documented developer workflow, separate from production deployment scripts.
- Replace Render-specific assumptions with shared-service configuration names, while preserving a single database URL contract through `RX1011_DATABASE_URL`.
- Revisit `RX1011_CORS_ORIGIN` after consolidation. Same-origin deployment may remove the need for broad CORS configuration.
- Isolate admin-only operational tools such as schema browsing and SQL execution from the normal user-facing API surface.
- Remove or formalize the CSV fallback for `/api/patients` before production consolidation.
- Validate legacy Vanilla frontend/backend dependencies before removal. The legacy backend may still serve flows not represented in the React app.
