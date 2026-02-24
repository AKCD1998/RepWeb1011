# Rx1011 Local Development

## 1) Environment files

### Backend (`server/.env`)
Copy `server/.env.example` to `server/.env` and set:

```env
DATABASE_URL=postgresql://...
PORT=5050
CORS_ORIGIN=http://localhost:5173
AUTH_JWT_SECRET=change-me
```

Notes:
- Backend loads env from `server/.env` first.
- If `server/.env` does not exist, backend falls back to project root `.env`.

### Frontend (`.env`)
Copy `.env.example` to `.env`:

```env
VITE_API_BASE=http://localhost:5050
```

If `VITE_API_BASE` is missing, frontend can still use Vite proxy for `/api`.

## 2) Vite proxy

Vite dev server proxies `/api` to `http://localhost:5050` in `vite.config.js`.

## 3) Install and run

```bash
npm install
npm run dev:full
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:5050`
- Health check: `GET http://localhost:5050/api/health`

## 4) Database migrations (PostgreSQL)

Apply migrations in order:

```bash
psql "$DATABASE_URL" -f migrations/0001_ky1011_schema.sql
psql "$DATABASE_URL" -f migrations/0002_ky1011_seed_reference.sql
psql "$DATABASE_URL" -f migrations/0004_ky1011_report_groups.sql
```

Important:
- `migrations/0003_ky1011_example_queries.sql` is a reference/query snippet file (contains placeholders like `:product_id`), not a migration to execute directly.

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
