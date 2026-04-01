# Lot-Specific Packaging Implementation Note

## Current Status

- Product-level packaging variants are supported and remain the source universe for valid unit levels.
- Lot-level whitelist foundation is implemented through `migrations/0017_product_lot_allowed_unit_levels.sql`.
- Read path is lot-aware:
  - `GET /api/products/:id/unit-levels` accepts `lotId` or `lotNo + expDate`
  - if a lot whitelist exists, only lot-allowed units are returned
  - if no lot whitelist exists, product-level fallback remains in place
- Write path enforcement is enabled for receive, transfer, dispense, and inventory movement writes:
  - if a lot whitelist exists, `unitLevelId` must be in that whitelist
  - if no lot whitelist exists, current product-level fallback behavior remains
- Admin can manage lot whitelist rows through the product admin area and lot whitelist endpoints.
- A read-only audit tool exists at `scripts/audit-lot-whitelists.mjs`.

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
