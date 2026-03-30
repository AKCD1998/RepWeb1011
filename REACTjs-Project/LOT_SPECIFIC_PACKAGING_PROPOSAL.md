# Lot-Specific Packaging Variants

## Summary

Some products can have more than one valid packaging level 2, and the valid outer package can vary by lot.

This means we should not treat packaging level 2 as a single, globally fixed property of the product.
If we overwrite an existing packaging row in `product_unit_levels`, old stock and old movements can be reinterpreted incorrectly.

The safer direction is:

- keep the smallest unit as the stable base unit at product level
- keep all possible packaging variants at product level
- add a lot-level mapping that says which unit levels are valid for each lot

## Why This Matters

Recent unit normalization work fixed products such as `IC-001674` so Receiving can default to the smallest unit first.
That normalization is still correct, but it assumes the outer package is stable per product.

That assumption can break when the manufacturer ships the same product in different box sizes across different lots.

Example:

- Product: `IC-001674`
- Current database state:
  - `1 แผง x 10 เม็ด` as base unit
  - `1 กล่อง x 3 แผง x 10 เม็ด` as one outer package
- Real-world future case:
  - another lot may use `1 กล่อง x 10 แผง x 10 เม็ด`
- Possible coexistence:
  - old stock may still exist for `1 กล่อง x 3 แผง`
  - new stock may arrive as `1 กล่อง x 10 แผง`
  - in some cases both package variants may need to coexist for the same product

## Current Model Limits

Current schema facts:

- `product_unit_levels` is scoped to `product_id`, not to `lot`
- `product_unit_conversions` is scoped to `product_id`, not to `lot`
- `product_lots` has no packaging profile or allowed-unit mapping
- Receiving currently loads unit options by product, then sorts by smallest `quantityPerBase`

Relevant code/schema references:

- `migrations/0001_ky1011_schema.sql`
  - `product_unit_levels`
  - `product_unit_conversions`
  - `product_lots`
- `src/pages/Receiving.jsx`
  - unit options are loaded from product unit levels and sorted smallest-first
- `server/controllers/productsController.js`
  - some product list flows still collapse package display into one primary `packageSize`

This means:

- the app can already support multiple unit levels per product
- the app cannot currently say "lot A allows box-of-3, lot B allows box-of-10"
- if we mutate an existing row from `BOX_3_BLISTER` into `BOX_10_BLISTER`, historical data becomes ambiguous or wrong

## What We Must Not Do

Do not update one existing packaging row in place to represent a different packaging multiplier later.

Bad example:

- existing row: `BOX_3_BLISTER`
- later overwrite it to become `BOX_10_BLISTER`

Why this is dangerous:

- old `stock_movements.unit_level_id` may still point to that row
- old `stock_on_hand.base_unit_level_id` and reporting assumptions may become misleading
- historical UI labels can change retroactively
- audits become harder because one row starts meaning two different things over time

## Recommended Model

### 1. Product-Level Unit Universe

At product level, keep every packaging variant that can exist for that product.

Example for `IC-001674`:

- `SELLABLE = 1 แผง x 10 เม็ด`
- `BOX_3_BLISTER = 1 กล่อง x 3 แผง x 10 เม็ด`
- `BOX_10_BLISTER = 1 กล่อง x 10 แผง x 10 เม็ด`

Rules:

- smallest unit stays stable
- each packaging variant gets its own distinct `code`
- each packaging variant gets its own conversion row
- existing rows are additive, not overwritten

### 2. Lot-Level Allowed Unit Mapping

Add a new table, for example:

`product_lot_allowed_unit_levels`

Suggested shape:

```sql
CREATE TABLE product_lot_allowed_unit_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_lot_id uuid NOT NULL REFERENCES product_lots (id) ON DELETE CASCADE,
  unit_level_id uuid NOT NULL REFERENCES product_unit_levels (id) ON DELETE RESTRICT,
  is_default boolean NOT NULL DEFAULT false,
  note_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_product_lot_allowed_unit_level UNIQUE (product_lot_id, unit_level_id)
);

CREATE UNIQUE INDEX uq_product_lot_default_unit_level
  ON product_lot_allowed_unit_levels (product_lot_id)
  WHERE is_default;
```

Expected meaning:

- one lot can allow one or more unit levels
- exactly zero or one row per lot can be the default
- if a lot is allowed to exist in both `BOX_3_BLISTER` and `BOX_10_BLISTER`, both rows can be present

### 3. Receiving Behavior

Target flow:

1. User selects product.
2. User selects or creates lot.
3. System loads allowed unit levels for that lot.
4. Unit select is filtered to those allowed rows.
5. If the lot has a default unit level, preselect it.
6. Quantity is converted to base quantity the same way as today.

Fallback for backward compatibility:

- if a lot has no mapping yet, use current product-level unit behavior
- optionally show a warning that the lot has no packaging profile yet

## Why This Is Safer

Advantages:

- additive model, not destructive
- preserves historical meaning of existing `unit_level_id`
- keeps stock math anchored to smallest unit
- supports multiple packaging variants for the same product
- supports future lot-level validation without breaking old records
- lets Receiving continue to work during rollout via fallback behavior

## Known Risks And Regression Concerns

### 1. Product List Still Assumes One Main Package Label

Some API flows still derive a single `packageSize` from one primary unit row.

Impact:

- if both `BOX_3_BLISTER` and `BOX_10_BLISTER` exist, one label may be shown while hiding the other
- product list screens may become misleading even if Receiving is correct

Likely fix:

- change product list/package display from "one package size" to either:
  - "multiple packaging variants"
  - or a richer packaging summary

### 2. Legacy Lots Have No Mapping

Old lots will not automatically know which unit levels are allowed.

Impact:

- without fallback, old flows would break
- with fallback, old flows keep working but validation is weaker until backfill is done

Recommended response:

- keep fallback behavior first
- backfill lot mappings later for known high-risk products

### 3. Same Product May Need Multiple Outer Packages Simultaneously

This is not a bug in the proposed model.
The model supports it, but the UI must make that visible.

Impact:

- unit dropdown must show multiple valid outer package variants clearly
- labels must stay explicit, for example `1 กล่อง x 3 แผง x 10 เม็ด` vs `1 กล่อง x 10 แผง x 10 เม็ด`

### 4. Transfers And Dispense Flows May Still Use Product-Level Units

Receiving is not the only consumer of unit levels.

Impact:

- transfer or dispense flows may also need lot-aware unit filtering if they expose unit selection
- otherwise users may still pick an invalid package variant for a lot outside Receiving

### 5. Barcodes May Also Vary By Packaging Variant

If outer package barcodes differ by packaging variant, we may eventually need to ensure the barcode points to the correct `unit_level_id`.

Impact:

- search behavior can become ambiguous if the same product has multiple valid package barcodes
- lot-aware barcode workflows may need additional rules later

## Implementation Proposal

### Phase 1. Schema Only, Additive

- add `product_lot_allowed_unit_levels`
- do not remove or rewrite existing product-level unit rows
- do not change stock calculation tables

### Phase 2. Read APIs

- add API to fetch allowed unit levels for a lot
- if no rows exist for the lot, fallback to current product unit levels

### Phase 3. Receiving

- after product + lot selection, filter unit dropdown by lot mapping
- preselect lot default unit if present
- keep current smallest-unit-first sort inside the filtered set
- preserve fallback when lot mapping is missing

### Phase 4. Admin / Master Data

- let admin assign or edit allowed packaging variants per lot
- optionally allow setting one default variant per lot
- log changes because packaging profile changes can affect operational behavior

### Phase 5. Product List And Reporting Cleanup

- replace single `packageSize` assumptions where necessary
- show a summary like `หลายรูปแบบบรรจุ` when multiple outer packages exist

## Practical Rules For Future Changes

- never mutate an existing packaging row to represent a different multiplier
- always create a new `product_unit_levels` row for a new packaging variant
- keep smallest unit stable whenever possible
- keep stock and quantity math based on the smallest unit
- make lot-specific restrictions additive and reversible
- prefer fallback over hard failure during rollout

## Open Questions

- Should a newly created lot require explicit packaging mapping before first save, or should it start in fallback mode?
- Should lot packaging mapping be admin-only?
- Should the same lot be allowed to have more than one outer package at the same time?
- Do any barcode workflows require lot-specific packaging validation from day one?
- Which screens besides Receiving need lot-aware unit filtering in phase 1?

## Recommended First Build

The safest first implementation is:

- additive schema
- fallback-safe APIs
- Receiving lot-aware unit filtering
- no destructive migration of historical unit rows

This gives us lot-specific packaging control without breaking existing stock logic.
