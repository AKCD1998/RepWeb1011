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
```

If `VITE_API_BASE` is missing, frontend can still use Vite proxy for `/api` in local development.

## 2) Vite proxy

Vite dev server proxies `/api` to the backend target from `VITE_API_PROXY_TARGET` or `http://localhost:5050`.

Production note:
- The frontend now uses `HashRouter`, so deployed URLs look like `/#/deliver` and avoid 404 on static hosting without rewrite rules.
- For deployed frontend builds, set `VITE_API_BASE=https://your-backend-service.onrender.com`
- Vite proxy is only for local development, not for production.

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

Render backend deployment:
- Blueprint file is at `../render.yaml`
- Backend service uses `rootDir: REACTjs-Project`
- Recommended Render environment variables:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `CORS_ORIGIN`

Optional GitHub Actions CD to Render:
- Add repository secret `RENDER_DEPLOY_HOOK_URL`
- When pushing to `main` or `master`, the workflow will trigger Render deploy automatically after CI passes



รูปแบบการก๊อปปี้จากหน้าโปรแกรม (เก็บไว้ใช้ทดสอบ)
ชื่อ : นาย ชวิศ ดิษฐาพร
เลขที่บัตร : 1103000134333
วันเกิด : 05 พฤษภาคม 2541
เพศ : ชาย
ออกบัตรที่: อำเภอปากท่อ/ราชบุรี
ออกบัตร ณ วันที่ : 02 พฤษภาคม 2568
วันที่หมดอายุ : 04 พฤษภาคม 2576
ที่อยู่ : 32/189 หมู่ที่ 1 ตำบลคลองสี่ อำเภอคลองหลวง จังหวัดปทุมธานี
