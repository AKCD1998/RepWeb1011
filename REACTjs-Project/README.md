# Rx1011 Local Development

## 0) DB Quick Answers

| Question | Use this |
|---|---|
| What DB should I use for local dev? | `local-simulation` at `localhost:55433/rx1011_local` |
| What DB should I use for live/prod/staging? | `render-live` via `RX1011_DATABASE_URL` |
| Which DB should receive migrations during testing? | `local-simulation` |
| Which DB should never be confused with production? | `local-simulation`, `legacy-local-5433`, and any stale `55432` setup |

See also: [docs/local-db-standardization-20260408.md](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/docs/local-db-standardization-20260408.md)

## 1) Environment files

### Backend live/prod/staging (`server/.env`)
Copy `server/.env.example` to `server/.env` and set:

```env
RX1011_DATABASE_URL=postgresql://...
PORT=5050
RX1011_CORS_ORIGIN=http://localhost:5173,https://your-frontend-host.example
RX1011_JWT_SECRET=change-me
```

Notes:
- Backend runtime uses exactly one PostgreSQL connection target via `RX1011_DATABASE_URL` or fallback `DATABASE_URL`.
- `server/.env` is the `render-live` backend env shape. On shared services, `RX1011_DATABASE_URL` is the canonical live source of truth.
- Backend loads env from `server/.env` first.
- If `server/.env` does not exist, backend falls back to project root `.env`.
- Do not reuse `server/.env` for local simulation.

### Backend local simulation (`server/.env.local-simulation`)
Copy `server/.env.local-simulation.example` to `server/.env.local-simulation`.

Repo standard `local-simulation` target:

```env
DATABASE_URL=postgresql://rx1011:rx1011@localhost:55433/rx1011_local
PGHOST=localhost
PGPORT=55433
PGUSER=rx1011
PGPASSWORD=rx1011
PGDATABASE=rx1011_local
```

Notes:
- `server/.env.local-simulation` is the standard local-dev profile.
- Local simulation scripts refuse non-loopback `DATABASE_URL` values so they cannot silently hit Render/live PostgreSQL.
- `localhost:5433` is `legacy-local-5433`, not part of the default workflow.
- any old `localhost:55432` setup is stale/legacy and should not be treated as the current local default.

### Frontend (`.env`)
Copy `.env.example` to `.env`:

```env
VITE_API_BASE=http://localhost:5050
VITE_API_PROXY_TARGET=http://localhost:5050
VITE_SMARTCARD_MQTT_URL=ws://localhost:10884/mqtt
VITE_SMARTCARD_MQTT_TOPIC=moph/ict/mqtt
```

If `VITE_API_BASE` is missing, frontend can still use Vite proxy for `/api` in local development.
If the smartcard vars are missing, the deliver page falls back to `ws://localhost:10884/mqtt` and `moph/ict/mqtt`.

## 2) Vite proxy

Vite dev server proxies `/api` to the backend target from `VITE_API_PROXY_TARGET` or `http://localhost:5050`.

Production note:
- The frontend now uses `HashRouter`, so deployed URLs look like `/#/deliver` and avoid 404 on static hosting without rewrite rules.
- For deployed frontend builds, set `VITE_API_BASE=https://your-backend-service.onrender.com`
- For deployed smartcard usage, `VITE_SMARTCARD_MQTT_URL` must point to a browser-reachable local bridge on the end-user machine.
- For GitHub Pages deployment, store `VITE_API_BASE` as a repository variable and `VITE_API_KEY` as a repository secret.
- Vite proxy is only for local development, not for production.

Smartcard note:
- The deliver page now opens an MQTT-over-WebSocket listener when the route is active.
- Default broker/topic are `ws://localhost:10884/mqtt` and `moph/ict/mqtt`, matching the `expWeb` prototype.
- The listener is page-scoped, auto-fills the deliver textarea when valid card data arrives, and does not auto-clear the textarea on card removal.
- Deployed browser access still depends on the end-user browser being allowed to reach that localhost WebSocket endpoint and on the local broker accepting the page origin.

## 3) Install and run

```bash
npm install
npm run dev:full
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:5050`
- Health check: `GET http://localhost:5050/api/health`
- Route example with hash router: `http://localhost:5173/#/deliver`

Standard `local-simulation` path:

```bash
cp .env.local-simulation.example .env.local-simulation
cp server/.env.local-simulation.example server/.env.local-simulation
docker compose -f docker-compose.local.yml up -d
npm run db:local-sim:bootstrap
npm run dev:local-sim
```

Notes:
- `npm run dev:local-sim` is the standard local DB workflow.
- `npm run dev:mock` remains as a backward-compatible alias.
- `npm run db:local:*` remains as a backward-compatible alias for the new `db:local-sim:*` names.

## 4) Database strategy and migrations

Canonical database strategy:
- `render-live` = Render PostgreSQL via `RX1011_DATABASE_URL`
- `local-simulation` = `localhost:55433/rx1011_local` for dev/test only
- `legacy-local-5433` = non-standard local PostgreSQL, optional/manual only
- old `55432` Docker setups = legacy and not part of the default workflow

Local testing and development:
- Prefer the local scripts instead of manual SQL ordering:

```bash
npm run db:local-sim:bootstrap
```

Important:
- `migrations/0003_ky1011_example_queries.sql` is a reference/query snippet file (contains placeholders like `:product_id`), not a migration to execute directly.
- The repo contains duplicate numbers such as `0010_*` and `0021_*`, so migration ordering must stay explicit.
- Local simulation scripts apply a curated order and keep post-catalog fix migrations separate from empty-database-safe schema migrations.
- The repo does not have a migration history table such as `schema_migrations`. Migration state is inferred from the live schema itself, not from stored migration bookkeeping.

Manual production/live migration policy:
- Do not auto-run migrations from Render.
- Review the target migration, then run it manually against the live `RX1011_DATABASE_URL`.
- As of `2026-04-08`, Render live still needs `migrations/0022_incident_report_resolution_actions.sql`.
- Use the production status/apply helpers for reviewed one-off migrations:

```bash
npm run db:prod:status:0022
npm run db:prod:apply:0022 -- --execute --allow-remote
```

- These helpers do not fake migration tracking. They only support migrations with explicit schema probes, and currently `0022_incident_report_resolution_actions.sql` is the reviewed production case.
- For a read-only object-level schema comparison between `render-live` and `local-simulation`, run:

```bash
npm run db:schema:diff:render-vs-localsim
```

- PowerShell example:

```powershell
psql $env:RX1011_DATABASE_URL --set ON_ERROR_STOP=1 --file migrations/0022_incident_report_resolution_actions.sql
```

- Bash example:

```bash
psql "$RX1011_DATABASE_URL" --set ON_ERROR_STOP=1 --file migrations/0022_incident_report_resolution_actions.sql
```

Seed login accounts after applying the auth migrations:
- `admin`
- `staff001`
- `staff003`
- `staff004`
- `staff005`

Password for all accounts above: `123123`

## 5) Main API endpoints

- `GET /api/products?search=...`
- `POST /api/products`
- `PUT /api/products/:id`
- `DELETE /api/products/:id` (soft delete)
- `POST /api/inventory/receive`
- `POST /api/inventory/transfer`
- `PATCH /api/inventory/movements/:id/occurred-at-correction` (admin only)
- `POST /api/dispense`
- `GET /api/stock/on-hand?branchCode=...`
- `GET /api/movements?productId=&branchCode=&from=&to=`
- `GET /api/patients/:pid/dispense?from=&to=`

## 6) CI/CD And Render

GitHub Actions:
- Workflow file is at `../.github/workflows/ci-cd.yml`
- On push / pull request, it runs `npm ci` and `npm run ci` inside `REACTjs-Project`
- `npm run ci` currently runs backend syntax checks and frontend production build
- On push to `main`, the same workflow deploys the frontend `dist/` folder to GitHub Pages after CI passes
- Required GitHub repository variable for Pages builds:
  - `VITE_API_BASE`
- Optional GitHub repository secret for Pages builds:
  - `VITE_API_KEY`

Render backend deployment:
- Blueprint file is at `../render.yaml`
- Backend service name is `rx1011-api`
- Backend service uses `branch: main` and `rootDir: REACTjs-Project`
- Auto-deploy is handled by Render using `autoDeployTrigger: checksPass`
- Keep Render `Pre-Deploy Command` empty for now
- Do not configure `RENDER_DEPLOY_HOOK_URL` when using Render auto-deploy for this service
- Render PostgreSQL remains the only live database source of truth for the deployed app
- Recommended Render environment variables:
  - `RX1011_DATABASE_URL`
  - `RX1011_JWT_SECRET`
  - `RX1011_CORS_ORIGIN`

Database migrations:
- Migrations remain manual in this setup. Do not auto-run them from Render yet.
- Follow the policy and commands in section `4) Database strategy and migrations`.
- For the current Render incident corrective-action rollout, see [docs/render-migration-0022-runbook-20260408.md](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/docs/render-migration-0022-runbook-20260408.md).
- `migrations/0003_ky1011_example_queries.sql` must never be auto-run.
- The repo currently contains both `0010_active_ingredients_name_en_uppercase_guard.sql` and `0010_seed_login_usernames_refresh.sql`.
  Treat that duplicate numbering as a known risk for future migration automation until it is intentionally resolved.



รูปแบบการก๊อปปี้จากหน้าโปรแกรม (เก็บไว้ใช้ทดสอบ)
ชื่อ : นาย ชวิศ ดิษฐาพร
เลขที่บัตร : 1103000134333
วันเกิด : 05 พฤษภาคม 2541
เพศ : ชาย
ออกบัตรที่: อำเภอปากท่อ/ราชบุรี
ออกบัตร ณ วันที่ : 02 พฤษภาคม 2568
วันที่หมดอายุ : 04 พฤษภาคม 2576
ที่อยู่ : 32/189 หมู่ที่ 1 ตำบลคลองสี่ อำเภอคลองหลวง จังหวัดปทุมธานี
