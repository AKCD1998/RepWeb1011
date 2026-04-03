# Local Simulation Guide

## Overview

Repo นี้ใช้ `PostgreSQL` ผ่าน backend ที่ [server/db/pool.js](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/db/pool.js) โดย production/runtime path จริงยังคงอิง `DATABASE_URL` เหมือนเดิม และ local simulation ที่เพิ่มเข้ามาใช้ script แยกใน `scripts/` เพื่อไม่ rewrite flow หลักของระบบ

สิ่งที่เพิ่มเข้ามา:

- `npm run db:local:init`
- `npm run db:local:migrate`
- `npm run db:local:seed`
- `npm run db:local:bootstrap`
- `npm run dev:mock`
- optional `docker-compose.local.yml`
- env templates สำหรับ local simulation

## DB Config In Repo

- Backend load env จาก `server/.env` ก่อน ถ้าไม่มีค่อย fallback ไป `.env`
- connection จริงใช้ `process.env.DATABASE_URL`
- auth ใช้ `JWT_SECRET`
- frontend local proxy/API base อยู่ใน `.env`

ไฟล์สำคัญ:

- [server/index.js](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/index.js)
- [server/db/pool.js](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/db/pool.js)
- [.env.example](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/.env.example)
- [server/.env.example](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/.env.example)

## Migration Source Of Truth

ใช้ `migrations/` เป็น source of truth หลัก แต่มี 3 จุดที่ต้องระวัง:

1. `0003_ky1011_example_queries.sql` เป็น reference only ห้ามรันเป็น migration
2. มีไฟล์เลขซ้ำ `0010_*` สองไฟล์ จึงไม่ควร auto-sort แบบ naive
3. `0008`, `0011`, `0014` เป็น data-fix migrations ที่อาศัย product catalog จริง ถ้ารันบน empty DB ตรง ๆ จะล้ม โดยเฉพาะ `0011_fix_ic003358_prednisolone_unit_levels.sql`

เพราะฉะนั้น local simulation นี้จะแยก migration เป็น 2 ช่วง:

- `db:local:migrate` รัน pre-seed migrations ที่ปลอดภัยกับ empty DB
- `db:local:seed` insert catalog ก่อน แล้วค่อยรัน `0008`, `0011`, `0014`

## Important Tables In Local Simulation

- `users`, `revoked_tokens`
- `locations`
- `patients`
- `products`
- `active_ingredients`, `product_ingredients`
- `unit_types`, `product_unit_levels`, `product_unit_conversions`
- `price_tiers`, `product_prices`
- `product_lots`
- `stock_movements`, `stock_on_hand`
- `dispense_headers`, `dispense_lines`
- `report_groups`, `product_report_groups`
- `inventory_transfer_requests`
- `product_lot_allowed_unit_levels`
- `stock_movement_occurred_at_audits`
- `admin_sql_query_audits`

## Endpoint To Table Map

- Auth
  - `POST /api/auth/login`
  - tables: `users`, `locations`
- Products
  - `GET/POST/PUT/DELETE /api/products`
  - tables: `products`, `active_ingredients`, `product_ingredients`, `product_unit_levels`, `product_unit_conversions`, `product_prices`, `product_report_groups`
- Stock lookup
  - `GET /api/stock/on-hand`
  - tables: `stock_on_hand`, `product_lots`, `product_unit_levels`, `locations`, `products`
- Receiving / movement history
  - `POST /api/inventory/movements`
  - `POST /api/inventory/movements/batch`
  - `GET /api/movements`
  - tables: `stock_movements`, `stock_on_hand`, `product_lots`, `product_unit_levels`
- Transfer notification flow
  - `GET /api/inventory/transfer-requests`
  - `POST /api/inventory/transfer-requests/:id/accept`
  - `POST /api/inventory/transfer-requests/:id/reject`
  - tables: `inventory_transfer_requests`, `stock_movements`, `stock_on_hand`
- Deliver / dispense
  - `POST /api/dispense`
  - `GET /api/dispense/history`
  - tables: `dispense_headers`, `dispense_lines`, `patients`, `stock_movements`, `stock_on_hand`
- Lot-specific packaging
  - `GET /api/products/:id/lot-whitelists`
  - `PUT /api/products/:id/lots/:lotId/whitelist`
  - tables: `product_lot_allowed_unit_levels`, `product_lots`, `product_unit_levels`
- Admin SQL editor
  - `POST /api/admin/sql/execute`
  - table: `admin_sql_query_audits`

## Option A: Use Docker PostgreSQL

1. Copy env templates
   - copy [.env.local-simulation.example](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/.env.local-simulation.example) to `.env.local-simulation`
   - copy [server/.env.local-simulation.example](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/.env.local-simulation.example) to `server/.env.local-simulation`
2. Start database

```powershell
docker compose -f docker-compose.local.yml up -d
```

3. Bootstrap database

```powershell
npm run db:local:bootstrap
```

4. Start app

```powershell
npm run dev:mock
```

## Option B: Use Existing Local PostgreSQL Service

ตั้ง `DATABASE_URL` หรือ `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` ใน `server/.env.local-simulation`

ตัวอย่าง:

```env
DATABASE_URL=postgresql://postgres@localhost:5432/rx1011_local
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=
PGDATABASE=rx1011_local
PORT=5050
JWT_SECRET=local-dev-only-change-me
```

แล้วรัน:

```powershell
npm run db:local:init
npm run db:local:migrate
npm run db:local:seed
npm run dev:mock
```

## What Seed Data Includes

- 4 branches: `001`, `003`, `004`, `005`
- office, warehouse, manufacturer, vendor locations
- login users หลาย role
- 23 products
- lot-aware stock across multiple branches
- receiving history
- accepted / pending / rejected transfer requests
- dispense history 5 headers
- patient list 5 records
- occurred-at correction audit
- admin SQL audit rows
- lot whitelist scenarios

กลุ่มสินค้าที่ครอบคลุม:

- migration target products สำหรับ `0008`, `0011`, `0014`
- liquid oral
- topical
- inhaler
- KY10 controlled-med example

## Login Accounts

Password ของทุกบัญชีด้านล่างคือ `123123`

- `admin` : ADMIN
- `staff001` : PHARMACIST at branch `001`
- `staff003` : PHARMACIST at branch `003`
- `staff004` : PHARMACIST at branch `004`
- `staff005` : PHARMACIST at branch `005`
- `operator001` : OPERATOR at branch `001`
- `operator003` : OPERATOR at branch `003`

## Ready-To-Verify Scenarios

- Login
  - use `admin` and `staff001`
- Products page
  - search `Metformin`, `Prednisolone`, `Diazepam`
- Receiving page
  - movement history includes receive, transfer out, transfer in, dispense
  - one receive row has `occurred_at` correction audit
- Transfer notifications
  - pending request exists for branch `005`
  - accepted and rejected requests are stored in history table
- Deliver page
  - `IC-003358` lot `PRED-2501` allows only blister
  - `IC-002205` lot `MET-2501` allows blister + box and defaults to box
- Patient history
  - 5 seeded patients with completed dispensing history
- Multi-branch
  - stock differs between branches `001`, `003`, `004`, `005`
- SQL editor
  - audit table already has both success and failure samples

## Scripts Added

- [scripts/db-local-init.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-local-init.mjs)
  - creates target local DB if missing
- [scripts/db-local-migrate.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-local-migrate.mjs)
  - applies pre-seed migration plan
- [scripts/db-local-seed.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/db-local-seed.mjs)
  - resets simulation-owned tables, seeds catalog/transactions, then applies post-catalog fixes
- [scripts/dev-mock.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/dev-mock.mjs)
  - runs backend + frontend with local-simulation env precedence
- [scripts/local-sim-env.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/local-sim-env.mjs)
  - shared env loading and migration execution
- [scripts/local-sim-data.mjs](/C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/scripts/local-sim-data.mjs)
  - deterministic simulation dataset

## Known Limitations

- `README.md` เดิมยังไม่สะท้อน migration ordering ล่าสุด
- reports page `/reports` ยังพึ่ง local static dataset บางส่วน ไม่ได้ดึงทุกอย่างจาก DB
- local simulation นี้เน้น relational flows หลัก ไม่ได้พยายาม mirror production volume จริง
- `db:local:seed` ถือว่าฐานนี้เป็น simulation database โดยจะ reset simulation-owned tables ก่อน seed ใหม่ทุกครั้ง
- ถ้าใช้ Docker ต้องมี Docker daemon เปิดอยู่

## Production-Sensitive Notes

- ไม่มีการใส่ real secret
- production runtime path เดิมไม่ได้ถูก rewrite
- env local simulation ใช้ไฟล์แยก `.env.local-simulation` / `server/.env.local-simulation`
- script ใหม่ออกแบบให้ explicit กับ local DB เท่านั้น ไม่ถูก auto-run ใน deploy path
