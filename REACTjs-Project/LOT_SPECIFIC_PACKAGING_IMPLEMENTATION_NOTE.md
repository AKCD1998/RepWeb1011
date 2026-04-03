# Lot-Specific Packaging Implementation Note

## Current Status

Last updated: 2026-04-02

- Product-level packaging variants are supported and remain the source universe for valid unit levels.
- Lot-level whitelist foundation is implemented through `migrations/0017_product_lot_allowed_unit_levels.sql`.
- Read path is lot-aware:
  - `GET /api/products/:id/unit-levels` accepts `lotId` or `lotNo + expDate`
  - if a lot whitelist exists, only lot-allowed units are returned
  - if no lot whitelist exists, product-level fallback remains in place
- Write path enforcement is enabled for receive, transfer, dispense, and inventory movement writes:
  - if a lot whitelist exists, `unitLevelId` must be in that whitelist
  - if no lot whitelist exists, current product-level fallback behavior remains
- Receiving movement modal now supports multi-line lot/package rows for one selected product in the same save flow:
  - receive can add multiple rows for new or existing lots
  - the same lot can be repeated across rows to represent separate packaging-level receipts in one session
  - each row resolves lot-aware unit options independently
- Multi-line modal save now submits through `POST /api/inventory/movements/batch`:
  - one modal save is executed inside one backend database transaction
  - if any row fails, the entire modal save is rolled back
- Transfer-out modal now reads live stock lots from the selected source branch only:
  - users must tick real lots from stock before entering transfer quantities
  - selected lots can be duplicated into multiple rows when the same lot needs to be split across packaging levels or quantities
  - transfer validation blocks quantities that exceed current stock for the selected lot
- A confirmation modal now appears before saving and summarizes:
  - movement type
  - product
  - from/to locations
  - lot, exp, quantity, and unit for every row
- Admin can manage lot whitelist rows through the product admin area and lot whitelist endpoints.
- A read-only audit tool exists at `scripts/audit-lot-whitelists.mjs`.

## Movement Logic Audit – 2026-04-02

### What Was Verified

- Frontend multi-line movement entry is present in `src/pages/Receiving.jsx` for:
  - `RECEIVE`
  - `TRANSFER_OUT`
  - `DISPENSE`
- The confirm modal is present and summarizes:
  - movement type
  - product
  - lot
  - exp
  - quantity
  - unit
  - from/to direction
- Backend source-of-truth validation for movement writes is in `server/controllers/inventoryController.js`:
  - `createMovement`
  - `receiveInventory`
  - `transferInventory`
  - `acceptTransferRequest`
  - `rejectTransferRequest`
- Stock decrement/increment enforcement is server-side through `applyStockDelta` in `server/controllers/helpers.js`.
- Lot-specific packaging whitelist enforcement is server-side through `assertUnitLevelAllowedForLot`.
- Branch-to-branch transfer remains modeled as:
  - immediate `TRANSFER_OUT` at source branch
  - pending row in `inventory_transfer_requests`
  - later `TRANSFER_IN` only when destination accepts
  - compensating return movement when destination rejects

### What Was Hardened In This Audit

- `GET /api/stock/on-hand` is now authenticated instead of public.
- `GET /api/stock/on-hand` now reads from `stock_on_hand`, which is the same source used by server-side stock validation, instead of recomputing availability from the ledger separately.
- Non-admin stock lookup is now forced to the viewer's own branch on the server side.
- Frontend movement save now forwards canonical `lotId` when available instead of relying only on `lotNo + expDate`.
- Positive stock-upsert on first insert is more resilient against concurrent writes on the same stock row.
- Multi-line movement save now uses a backend batch endpoint that reuses the same movement business logic inside one DB transaction.

### Verified Safe Enough

- Branch-to-branch transfer cannot silently receive stock into the destination before acceptance.
- Source-branch stock is decremented server-side inside a transaction before a pending transfer request is created.
- Destination accept/reject is transactional and auditable.
- Multi-line modal save is now atomic at the backend transaction level.
- Existing lot receive uses the existing `product_lots` row when `product_id + lot_no + exp_date` matches.
- New lot receive creates a new `product_lots` row when the exp differs or the lot is new.
- Lot whitelist enforcement is backend-enforced for receive, transfer, and dispense writes.

### Still Risky / Not Fully Solved

- The current data model tracks stock by branch + product + lot in base units. It does not track physically remaining stock by packaging level. That means the system can prove:
  - the lot exists
  - the lot has enough base-unit quantity
  - the chosen packaging is allowed for that lot
  but it cannot prove that a specific packaging form is still physically available as a separate untouched package.
- As a result, transfer is branch-stock-safe at lot/base-quantity level, but not fully packaging-specific-stock-safe yet.
- Confirm modal summary reflects the intended payload fields, but the system still stores branch-to-branch transfer as one pending transfer request per row rather than one grouped transfer document for the whole modal action.

## Batch Movement Atomicity Fix – 2026-04-02

### Previous Problem

- The redesigned multi-line modal built multiple movement payloads and submitted them one-by-one through `POST /api/inventory/movements`.
- If an early row succeeded and a later row failed, the user action was partially persisted.
- This was especially risky for:
  - multi-line receive into several lots
  - multi-line transfer batches from one branch
  - repeated rows of the same lot split across packaging levels

### What Changed

- Added `POST /api/inventory/movements/batch`.
- Extracted shared movement-write logic so both:
  - `POST /api/inventory/movements`
  - `POST /api/inventory/movements/batch`
  use the same backend validations and persistence rules.
- The batch endpoint runs the entire array inside one database transaction.
- The frontend Receiving modal now submits the whole modal save once through the batch endpoint instead of sending rows sequentially.

### Atomicity Result

- One modal save now equals one backend transaction.
- If any row in the batch fails:
  - all movement rows are rolled back
  - all stock_on_hand deltas are rolled back
  - all pending branch transfer requests created earlier in the batch are rolled back
  - the user gets one clear failure message instead of ambiguous partial success

### Still Out Of Scope

- Packaging-level physical stock modeling is still not implemented.
- Batch save is atomic, but branch-to-branch transfer lines are still represented as separate pending transfer requests per row.
- This fix improves transaction safety, not the underlying packaging-specific stock model.

## Migration Order

Recommended deployment order:

1. Apply `migrations/0016_product_unit_levels_is_active.sql`
2. Apply `migrations/0017_product_lot_allowed_unit_levels.sql`
3. Restart the backend
4. Run `npm run audit:lot-whitelists`
5. Smoke-test:
   - product unit lookup without lot
   - product unit lookup with lot
   - receive / transfer / dispense using a whitelisted lot
   - lot whitelist admin read/update

Why `0016` before `0017`:

- `0016` makes `product_unit_levels.is_active` explicit and indexed.
- The codebase has compatibility logic for environments that still lack `0016`, but safe product-level retirement/replacement flows still depend on `0016`.
- `0017` can be read compatibly even if `0016` is absent, but rollout should still treat `0016 -> 0017` as the supported deployment order.

## Behavior By Deployment State

### When `0017` is not applied

- Read path:
  - lot-aware unit lookup falls back to product-level behavior
- Write path:
  - lot whitelist enforcement is skipped because the whitelist table is unavailable
- Admin path:
  - lot whitelist management endpoints return a clear `409`
- Tooling:
  - `npm run audit:lot-whitelists` exits with a clear migration warning
- Logging:
  - the server emits a one-time warning that lot whitelist behavior remains on transitional fallback

### When `0017` is fully applied

- Historical seed backfill runs once inside the migration
- Read path uses lot whitelist when present
- Write path enforces `unit not allowed for this lot` when a whitelist exists and the chosen unit is outside it
- Admin lot whitelist APIs/UI are available
- Audit script can scan live data for rollout issues

### When `0017` is partially or incorrectly applied

- The migration itself is wrapped in `BEGIN/COMMIT`, so a normal failed migration should roll back instead of leaving a half-applied state
- The main realistic partial-state risk is manual or out-of-band DDL that creates the table but not the required columns
- The server now treats `product_lot_allowed_unit_levels` as available only when the required columns exist:
  - `product_id`
  - `product_lot_id`
  - `unit_level_id`
  - `is_active`
  - `is_default`
- If the table exists but is incomplete:
  - read path falls back instead of assuming whitelist is usable
  - write enforcement does not try to query broken whitelist data
  - admin lot whitelist endpoints return the same migration-required `409`
  - the server logs a one-time warning
  - `npm run audit:lot-whitelists` exits with a clear incomplete-schema error

## Historical Backfill Rules

- `0017` seeds historical lots only when the product has exactly one unambiguous true secondary packaging row
- Preferred seed rule:
  - `unit_key` with `lvl=2` and `parent=1`
- Legacy fallback rule:
  - blank `unit_key`
  - `sort_order = 2`
  - `is_base = false`
- `IC-999999` is intentionally excluded from seed backfill
- Lots with no unambiguous secondary packaging stay unmapped on purpose and continue using product-level fallback until explicitly mapped

## Fallback Model

- No lot selected:
  - product-level unit behavior remains unchanged
- Lot selected but lot not found:
  - read path falls back to product-level
- Lot exists but has no whitelist rows:
  - read path falls back to product-level
  - write path allows current product-level behavior
- Lot has whitelist rows:
  - read path returns only lot-allowed unit levels
  - write path requires the chosen `unitLevelId` to be in the lot whitelist
- Lot whitelist rows exist but none resolve to active product unit levels:
  - read path returns an empty lot-scoped set so bad mapping data is visible
  - write path rejects usage for units outside valid active whitelist rows
  - audit script reports the lot as problematic

## Rollout Steps

1. Back up the database or confirm the normal migration backup point exists
2. Apply `0016`
3. Apply `0017`
4. Restart backend processes
5. Run:
   - `npm run audit:lot-whitelists`
   - `npm run check:server`
   - `npm run build`
6. Verify a few representative products/lots:
   - a lot with seeded whitelist
   - a lot with no whitelist
   - a product with product-level packaging variants
7. Watch logs for one-time lot whitelist deployment warnings
8. If audit reports issues, stop rollout and clean up data before enabling staff usage on affected lots

## Rollback Strategy

Recommended rollback is application-first, not schema-destructive:

1. Roll back application code if the new behavior is causing operational issues
2. Keep `0016` and `0017` in place unless there is a controlled database rollback plan
3. Use the audit script to inspect bad whitelist data instead of dropping tables
4. If needed, leave lots unmapped so fallback behavior continues while data is corrected

Why avoid immediate schema rollback:

- `0017` stores additive whitelist history and seed rows
- Dropping or rewriting it is riskier than temporarily reverting app code while keeping the data for diagnosis

## Known Risks

- Historical seed is intentionally conservative, not perfect truth for every old lot
- Lots without mappings still rely on fallback behavior
- Direct DB edits can create invalid whitelist rows unless controlled carefully
- Cross-environment drift remains possible if one environment has `0017` and another does not
- Product-level admin retirement/replacement safety still depends on `0016`

## Monitoring Checklist

- Check server logs for:
  - missing `0017` warning
  - incomplete `0017` schema warning
- Monitor API errors for:
  - `409` responses from lot whitelist admin endpoints
  - `400 unit not allowed for this lot`
- Run `npm run audit:lot-whitelists -- --json` during rollout validation
- Review audit output for:
  - `EMPTY_ACTIVE_LOT_WHITELIST`
  - `WHITELIST_REFERENCES_MISSING_UNIT`
  - `WHITELIST_REFERENCES_INACTIVE_UNIT`
  - `DUPLICATE_ACTIVE_WHITELIST_MAPPINGS`
- Verify at least one write flow each for:
  - receive
  - transfer
  - dispense
  - inventory movement

## Still Intentionally Incomplete

- This is not full final lot-specific packaging lifecycle management
- Rollout still depends on operational monitoring and data audit
- Historical seed/backfill remains a transitional starting point, not final lot truth
- Multi-line receive/transfer modal saves are now atomic, but they still create one logical movement result per row inside the batch
- Branch-to-branch transfer rows are still stored as one transfer request / movement per submitted line, not yet as one grouped transactional document
- Packaging-specific physical stock state is not yet modeled separately from lot/base-unit stock

## Follow-up Queue

### Deliver Lot Dropdown Must Be Branch-Stock Scoped

Pending follow-up after the current movement work:

- File: `src/pages/Deliver.jsx`
- UI field: `เลข lot number` dropdown in the deliver screen
- Current check result:
  - the dropdown does not read from `product_lots` directly
  - it reads through `fetchProductLots()` in `src/utils/deliverCache.js`
  - that helper calls `GET /api/stock/on-hand`
  - backend `getStockOnHand()` reads from `stock_on_hand` and filters `quantity_on_hand > 0`
- Intended next fix:
  - the deliver lot dropdown must show only lots that currently have positive stock in the acting branch
  - non-admin users must remain scoped to their own branch only
  - admin users must also be scoped to the currently selected branch in the deliver screen, not all branches combined
- Known caveat from the code trace:
  - the current deliver lot fetch path does not pass `selectedBranchCode` for admin lot lookup
  - therefore admin lot options may currently mix lots from multiple branches if the same product has stock in more than one branch
  - `fetchProductLots()` currently uses raw `fetch()` instead of the authenticated API client, so the auth path should be reviewed as part of the fix
- Out-of-scope for that follow-up:
  - this note does not claim that the deliver lot dropdown bug is already fixed
  - this is a queued follow-up item to implement next



เช็คแล้ว ตามโค้ดปัจจุบันคำตอบคือ:

ไม่ใช่การดึง “lot ทั้งหมดที่เคยมีในฐานข้อมูล” ตรง ๆ  
ตัว dropdown นี้ใน [Deliver.jsx](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/src/pages/Deliver.jsx:1023) ใช้ `lotOptions` ที่ถูกโหลดจาก `fetchProductLots(...)` ใน [Deliver.jsx](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/src/pages/Deliver.jsx:385) และฟังก์ชันนั้นไปเรียก `/api/stock/on-hand` ใน [deliverCache.js](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/src/utils/deliverCache.js:317)

ฝั่ง backend `/api/stock/on-hand` ใน [reportingRoutes.js](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/routes/reportingRoutes.js:9) ไปที่ [getStockOnHand](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/controllers/inventoryController.js:1367) ซึ่ง query จาก `stock_on_hand` และมีเงื่อนไข `soh.quantity_on_hand > 0` ใน [inventoryController.js](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/controllers/inventoryController.js:1419)  
ดังนั้น “ตาม intent ของ backend” มันควรโชว์เฉพาะ lot ที่ยังมี stock คงเหลือ ไม่ใช่ lot เก่าทั้งหมดใน `product_lots`

เรื่องสาขาอื่นปนกับ user อื่น:
- สำหรับ user ทั่วไปที่ไม่ใช่ `ADMIN`: backend บังคับ scope ไปที่สาขาของ user เองใน [inventoryController.js](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/controllers/inventoryController.js:1374) ถึง [inventoryController.js](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/controllers/inventoryController.js:1384) เพราะฉะนั้นตามโค้ด ฝั่ง user ปกติไม่ควรเห็น lot ของสาขาอื่น
- สำหรับ `ADMIN`: มีช่องโหว่เชิง logic อยู่ เพราะหน้า Deliver มีตัวเลือก `selectedBranchCode` สำหรับสาขาที่ทำรายการใน [Deliver.jsx](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/src/pages/Deliver.jsx:1088) แต่ตอน fetch lot ไม่ได้ส่ง `branchCode` นี้ไปด้วย มีแค่ `productId`/`productCode` ใน [deliverCache.js](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/src/utils/deliverCache.js:322) ดังนั้นสำหรับ admin lot list มีโอกาสรวม lot ที่ยังมี stock จากหลายสาขาได้

มีอีกประเด็นที่ต้องรู้:
- `fetchProductLots()` ใช้ `fetch()` ตรง ๆ ใน [deliverCache.js](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/src/utils/deliverCache.js:325)
- แต่ `/api/stock/on-hand` ต้องมี `Bearer token` ตาม [reportingRoutes.js](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/routes/reportingRoutes.js:9) และ [authMiddleware.js](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/server/middleware/authMiddleware.js:83)
- ขณะที่ตัวที่ใส่ token อัตโนมัติคือ `authApiClient` ใน [authApi.js](C:/Users/scgro/Desktop/Webapp%20training%20project/Rx1011/REACTjs-Project/src/lib/authApi.js:48)

สรุปสั้น ๆ:
- ไม่ใช่การโชว์ lot เก่าทั้งหมดใน DB
- สำหรับ user ปกติ ตามโค้ดไม่ควรปน lot ของสาขาอื่น
- สำหรับ admin ตอนนี้มีความเสี่ยงปน lot จากหลายสาขา เพราะ fetch lot ไม่ได้ผูกกับ `selectedBranchCode`
- และ code path นี้ยังดูมีบั๊ก auth อีกจุด เพราะใช้ `fetch()` ตรงแทน `authApiClient`

ถ้าต้องการ รอบถัดไปผมแก้ให้ตรงเป้าได้เลย: ให้ dropdown lot ใน Deliver แสดงเฉพาะ lot ที่ “มี stock อยู่จริงในสาขาที่กำลังทำรายการ” เท่านั้น ทั้งสำหรับ admin และ user ปกติ.