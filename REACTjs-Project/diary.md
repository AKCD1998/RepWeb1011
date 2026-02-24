## 2026-02-24 15:06:16 +07:00 - Deliver table: remove unit/sum columns
- Files changed: `src/pages/Deliver.jsx`, `src/pages/Deliver.css`.
- Removed from table UI:
  - Header `ราคาต่อหน่วย` (`hide-sm`) and row cell `item-price`.
  - Header `ราคารวม` (`sum`) and row cell `item-sum`.
- Kept POS logic unchanged: barcode lookup/add, qty behavior, delete action, and bottom grand total display.

How to verify:
- [ ] Add 2 items (scan/Enter), then add the same item again and confirm qty increments.
- [ ] Delete 1 item from `NOTE` column and confirm bottom grand total (`รวม`) updates.
- [ ] Open modal via `ยืนยันการทำรายการ`, close via cancel/close button, `Escape`, and backdrop click.
- [ ] Check narrow widths (<=768 and <=480) to ensure `hide-md` layout remains aligned with no awkward grid gaps.

## 2026-02-24 17:06:24 +07:00 - KY10/11 PostgreSQL schema design
- Summary:
  - Designed multi-branch PostgreSQL schema for ขย 10/11 dispensing + inventory tracking.
  - Added structured product composition (multi-ingredient), structured strength units, packaging hierarchy, stock ledger/snapshot, dispensing visit/line tables, user/patient/location masters, and configurable dispensing rules.
  - Added seed data for branches `001`, `003`, `004` plus minimal dosage forms and unit types.
  - Added ready-to-use example SQL queries for stock, movement audit, patient history, and rule-violation detection.
- Files added:
  - `SCHEMA_KY1011.md`
  - `migrations/0001_ky1011_schema.sql`
  - `migrations/0002_ky1011_seed_reference.sql`
  - `migrations/0003_ky1011_example_queries.sql`
- Next steps:
  - Run migrations in a PostgreSQL environment and validate with sample products/lots.
  - Implement application service/trigger to keep `stock_on_hand` synchronized from `stock_movements`.
  - Add conversion-aware rule check (BOX -> BLISTER, etc.) in service/query layer for stricter enforcement.

## 2026-02-24 17:14:00 +07:00 - Add regulatory report grouping (KY10/KY11)
- Summary:
  - Added extensible regulatory grouping model with effective dating (`report_groups`, `product_report_groups`).
  - Seeded report groups: `KY10` and `KY11`.
  - Added query examples for current KY10/KY11 membership, overlap, KY11 dispensing history, and missing classification detection.
  - Updated schema document with architecture rationale and textual ER diagram for regulatory mapping.
- Files changed:
  - `migrations/0004_ky1011_report_groups.sql`
  - `migrations/0003_ky1011_example_queries.sql`
  - `SCHEMA_KY1011.md`
  - `diary.md`
- Next steps:
  - Implement KY10/KY11 report-generation SQL view(s) using `dispense_headers`, `dispense_lines`, and time-valid `product_report_groups`.
  - Add automated validation tests for effective date windows and duplicate/overlap policy.

## 2026-02-24 17:50:50 +07:00 - Backend env/API MVP with PostgreSQL
- Summary:
  - Implemented server-first environment loading (`server/.env`, fallback to root `.env`) and added env examples.
  - Added PostgreSQL access layer with `pg` pool and health check, plus modular Express structure (`routes` + `controllers`).
  - Implemented transactional endpoints for product CRUD, inventory receive/transfer, dispensing, stock on hand, movements, and patient dispense history.
  - Implemented stock snapshot updates (`stock_on_hand`) in the same DB transaction as movement inserts.
  - Added frontend API wrapper and a working Products CRUD screen connected to backend HTTP APIs.
  - Updated Vite proxy to backend port `5050`, and kept `/api/patients` compatibility endpoint (DB first, CSV fallback).
- Files added/changed:
  - `server/.env.example`
  - `.env.example`
  - `.gitignore`
  - `server/index.js`
  - `server/db/pool.js`
  - `server/controllers/helpers.js`
  - `server/controllers/productsController.js`
  - `server/controllers/inventoryController.js`
  - `server/controllers/dispenseController.js`
  - `server/routes/productsRoutes.js`
  - `server/routes/inventoryRoutes.js`
  - `server/routes/dispenseRoutes.js`
  - `server/routes/reportingRoutes.js`
  - `server/utils/asyncHandler.js`
  - `server/utils/httpError.js`
  - `migrations/0002_ky1011_seed_reference.sql` (seed `system` user)
  - `src/lib/api.js`
  - `src/pages/Products.jsx`
  - `src/pages/Products.css`
  - `src/App.jsx`
  - `src/components/Sidebar.jsx`
  - `src/utils/deliverApiBase.js`
  - `vite.config.js`
  - `README.md`
  - `diary.md`
- Next steps:
  - Add migration runner script (or npm script) to execute SQL files in order automatically.
  - Build dedicated Receive/Transfer/Deliver submit forms on top of new `src/lib/api.js` methods.
  - Add authentication middleware (JWT) and role-based authorization for write endpoints.
