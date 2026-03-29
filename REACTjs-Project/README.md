# Rx1011 Local Development

## 1) Environment files

### Backend (`server/.env`)
Copy `server/.env.example` to `server/.env` and set:

```env
DATABASE_URL=postgresql://...
PORT=5050
CORS_ORIGIN=http://localhost:5173,https://your-frontend-host.example
JWT_SECRET=change-me
```

Notes:
- Backend loads env from `server/.env` first.
- If `server/.env` does not exist, backend falls back to project root `.env`.

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

## 4) Database migrations (PostgreSQL)

Apply migrations in order:

```bash
psql "$DATABASE_URL" -f migrations/0001_ky1011_schema.sql
psql "$DATABASE_URL" -f migrations/0002_ky1011_seed_reference.sql
psql "$DATABASE_URL" -f migrations/0004_ky1011_report_groups.sql
psql "$DATABASE_URL" -f migrations/0005_auth_fields.sql
psql "$DATABASE_URL" -f migrations/0006_auth_revoked_tokens.sql
psql "$DATABASE_URL" -f migrations/0007_unit_level_code_stability.sql
psql "$DATABASE_URL" -f migrations/0008_fix_movement_unit_level_refs.sql
psql "$DATABASE_URL" -f migrations/0009_stock_movements_quantity_base_ssot.sql
psql "$DATABASE_URL" -f migrations/0010_seed_login_usernames_refresh.sql
psql "$DATABASE_URL" -f migrations/0011_fix_ic003358_prednisolone_unit_levels.sql
```

Important:
- `migrations/0003_ky1011_example_queries.sql` is a reference/query snippet file (contains placeholders like `:product_id`), not a migration to execute directly.

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
- Recommended Render environment variables:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `CORS_ORIGIN`

Database migrations:
- Migrations remain manual in this setup. Do not auto-run them from Render yet.
- Follow the ordered commands in section `4) Database migrations (PostgreSQL)`.
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
