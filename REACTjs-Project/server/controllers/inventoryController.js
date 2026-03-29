import { query, withTransaction } from "../db/pool.js";
import {
  applyStockDelta,
  assertLotBelongsToProduct,
  convertMovementToSignedBase,
  convertToBase,
  ensureLot,
  ensureProductExists,
  ensureProductUnitLevel,
  resolveProductBaseUnitLevel,
  resolveActorUserId,
  resolveBranchByCode,
  toIsoTimestamp,
  toPositiveNumeric,
} from "./helpers.js";
import { httpError } from "../utils/httpError.js";

const MOVEMENT_TYPES = new Set(["RECEIVE", "TRANSFER_OUT", "DISPENSE"]);
const LOCATION_TYPES = new Set([
  "BRANCH",
  "OFFICE",
  "MANUFACTURER",
  "WHOLESALER",
  "VENDOR",
  "WAREHOUSE",
  "OTHER",
]);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeRole(role) {
  return normalizeText(role).toUpperCase();
}

function toNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || "";
}

function requireNonEmptyText(value, fieldName) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw httpError(400, `${fieldName} is required`);
  }
  return normalized;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

function toIsoDateOnly(value, fieldName) {
  const text = normalizeText(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw httpError(400, `${fieldName} must be a valid date`);
  }
  return date.toISOString().slice(0, 10);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function toExistingIsoTimestamp(value, fieldName) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw httpError(500, `Stored ${fieldName} is invalid`);
  }
  return date.toISOString();
}

async function resolveActiveLocationById(client, locationId, fieldName) {
  const normalizedId = normalizeText(locationId);
  if (!normalizedId) return null;
  if (!isUuid(normalizedId)) {
    throw httpError(400, `${fieldName} must be a valid UUID`);
  }

  const result = await client.query(
    `
      SELECT
        id,
        code,
        name,
        location_type AS "locationType",
        is_active AS "isActive"
      FROM locations
      WHERE id = $1
      LIMIT 1
    `,
    [normalizedId]
  );

  if (!result.rows[0]) {
    throw httpError(404, `${fieldName} not found`);
  }
  if (!result.rows[0].isActive) {
    throw httpError(400, `${fieldName} is inactive`);
  }

  return result.rows[0];
}

async function resolveLotIdForMovement(
  client,
  { productId, movementType, explicitLotId, lotNo, expDate, mfgDate, manufacturer }
) {
  if (explicitLotId) {
    await assertLotBelongsToProduct(client, productId, explicitLotId);
    return explicitLotId;
  }

  if (!lotNo) throw httpError(400, "lotNo is required");
  if (!expDate) throw httpError(400, "expDate is required");

  if (movementType === "RECEIVE") {
    return ensureLot(client, {
      productId,
      lotNo,
      mfgDate: mfgDate || null,
      expDate,
      manufacturer: manufacturer || null,
    });
  }

  const lotResult = await client.query(
    `
      SELECT id
      FROM product_lots
      WHERE product_id = $1
        AND lot_no = $2
        AND exp_date = $3::date
      LIMIT 1
    `,
    [productId, lotNo, expDate]
  );

  if (!lotResult.rows[0]) {
    throw httpError(
      404,
      `Lot not found for product ${productId}: ${lotNo} (exp ${expDate})`
    );
  }

  return lotResult.rows[0].id;
}

async function resolveRequestedUnitLevel(
  client,
  { productId, unitLevelId, unitLabel, unitStructure = {} }
) {
  const normalizedUnitLevelId = normalizeText(unitLevelId);
  if (normalizedUnitLevelId) {
    if (!isUuid(normalizedUnitLevelId)) {
      throw httpError(400, "unit_level_id must be a valid UUID");
    }

    const result = await client.query(
      `
        SELECT id, code, display_name, unit_key, sort_order
        FROM product_unit_levels
        WHERE product_id = $1
          AND id = $2
        LIMIT 1
      `,
      [productId, normalizedUnitLevelId]
    );

    if (!result.rows[0]) {
      throw httpError(404, `unit_level_id not found for product ${productId}`);
    }

    return result.rows[0];
  }

  const normalizedUnitLabel = normalizeText(unitLabel);
  if (!normalizedUnitLabel) {
    throw httpError(400, "unitLabel is required");
  }

  return ensureProductUnitLevel(client, productId, normalizedUnitLabel, unitStructure);
}

export async function receiveInventory(req, res) {
  const toBranchCode = String(req.body?.toBranchCode || "").trim();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const occurredAt = toIsoTimestamp(req.body?.occurredAt);
  const note = req.body?.note || null;
  const createdByUserId = req.user?.id || req.body?.createdByUserId || null;

  if (!toBranchCode) throw httpError(400, "toBranchCode is required");
  if (!items.length) throw httpError(400, "items must contain at least one item");

  const result = await withTransaction(async (client) => {
    const branch = await resolveBranchByCode(client, toBranchCode);
    const actorUserId = await resolveActorUserId(client, createdByUserId);
    let movementCount = 0;

    for (const item of items) {
      const productId = item?.productId;
      const qty = toPositiveNumeric(item?.qty, "qty");
      const unitLabel = normalizeText(item?.unitLabel || item?.unit);
      const unitLevelId = normalizeText(item?.unitLevelId || item?.unit_level_id);
      if (!unitLevelId && !unitLabel) {
        throw httpError(400, "unitLevelId or unitLabel is required");
      }

      await ensureProductExists(client, productId);
      const unitLevel = await resolveRequestedUnitLevel(client, {
        productId,
        unitLevelId,
        unitLabel,
        unitStructure: item || {},
      });
      const baseUnitLevel = await resolveProductBaseUnitLevel(client, productId);
      const quantityBase = convertToBase(qty, unitLevel);

      const lotId =
        item?.lotId ||
        (await ensureLot(client, {
          productId,
          lotNo: item?.lotNo,
          mfgDate: item?.mfgDate || null,
          expDate: item?.expDate,
          manufacturer: item?.manufacturer || null,
        }));

      if (item?.lotId) {
        await assertLotBelongsToProduct(client, productId, item.lotId);
      }

      await client.query(
        `
          INSERT INTO stock_movements (
            movement_type,
            from_location_id,
            to_location_id,
            product_id,
            lot_id,
            quantity,
            quantity_base,
            unit_level_id,
            occurred_at,
            created_by,
            note_text
          )
          VALUES (
            'RECEIVE',
            NULL,
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7::timestamptz,
            $8,
            $9
          )
        `,
        [
          branch.id,
          productId,
          lotId || null,
          qty,
          quantityBase,
          unitLevel.id,
          occurredAt,
          actorUserId,
          note,
        ]
      );

      await applyStockDelta(client, {
        branchId: branch.id,
        productId,
        lotId: lotId || null,
        baseUnitLevelId: baseUnitLevel.id,
        deltaQtyBase: quantityBase,
      });

      movementCount += 1;
    }

    return {
      branchCode: branch.code,
      movementCount,
    };
  });

  return res.status(201).json({
    ok: true,
    ...result,
  });
}

export async function transferInventory(req, res) {
  const fromBranchCode = String(req.body?.fromBranchCode || "").trim();
  const toBranchCode = String(req.body?.toBranchCode || "").trim();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const occurredAt = toIsoTimestamp(req.body?.occurredAt);
  const note = req.body?.note || null;
  const createdByUserId = req.user?.id || req.body?.createdByUserId || null;

  if (!fromBranchCode) throw httpError(400, "fromBranchCode is required");
  if (!toBranchCode) throw httpError(400, "toBranchCode is required");
  if (fromBranchCode === toBranchCode) {
    throw httpError(400, "fromBranchCode and toBranchCode must be different");
  }
  if (!items.length) throw httpError(400, "items must contain at least one item");

  const result = await withTransaction(async (client) => {
    const fromBranch = await resolveBranchByCode(client, fromBranchCode);
    const toBranch = await resolveBranchByCode(client, toBranchCode);
    const actorUserId = await resolveActorUserId(client, createdByUserId);
    let movementCount = 0;

    for (const item of items) {
      const productId = item?.productId;
      const qty = toPositiveNumeric(item?.qty, "qty");
      const unitLabel = normalizeText(item?.unitLabel || item?.unit);
      const unitLevelId = normalizeText(item?.unitLevelId || item?.unit_level_id);
      if (!unitLevelId && !unitLabel) {
        throw httpError(400, "unitLevelId or unitLabel is required");
      }

      await ensureProductExists(client, productId);
      const unitLevel = await resolveRequestedUnitLevel(client, {
        productId,
        unitLevelId,
        unitLabel,
        unitStructure: item || {},
      });
      const baseUnitLevel = await resolveProductBaseUnitLevel(client, productId);
      const quantityBase = convertToBase(qty, unitLevel);
      const lotId = item?.lotId || null;
      if (lotId) {
        await assertLotBelongsToProduct(client, productId, lotId);
      }

      await applyStockDelta(client, {
        branchId: fromBranch.id,
        productId,
        lotId,
        baseUnitLevelId: baseUnitLevel.id,
        deltaQtyBase: -quantityBase,
      });
      await applyStockDelta(client, {
        branchId: toBranch.id,
        productId,
        lotId,
        baseUnitLevelId: baseUnitLevel.id,
        deltaQtyBase: quantityBase,
      });

      await client.query(
        `
          INSERT INTO stock_movements (
            movement_type,
            from_location_id,
            to_location_id,
            product_id,
            lot_id,
            quantity,
            quantity_base,
            unit_level_id,
            occurred_at,
            created_by,
            note_text
          )
          VALUES
            ('TRANSFER_OUT', $1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10),
            ('TRANSFER_IN',  $1, $2, $3, $4, $5, $11, $7, $8::timestamptz, $9, $10)
        `,
        [
          fromBranch.id,
          toBranch.id,
          productId,
          lotId,
          qty,
          -quantityBase,
          unitLevel.id,
          occurredAt,
          actorUserId,
          note,
          quantityBase,
        ]
      );

      movementCount += 2;
    }

    return {
      fromBranchCode: fromBranch.code,
      toBranchCode: toBranch.code,
      movementCount,
    };
  });

  return res.status(201).json({
    ok: true,
    ...result,
  });
}

export async function createMovement(req, res) {
  const movementType = normalizeText(req.body?.movementType).toUpperCase();
  const productId = normalizeText(req.body?.productId);
  const qty = toPositiveNumeric(req.body?.qty, "qty");
  const unitLevelIdInput = normalizeText(req.body?.unitLevelId || req.body?.unit_level_id);
  const unitLabel = normalizeText(req.body?.unitLabel || req.body?.unit);
  const lotIdInput = normalizeText(req.body?.lotId || req.body?.lot_id);
  const lotNo = normalizeText(req.body?.lotNo || req.body?.lot_no);
  const expDate = toIsoDateOnly(req.body?.expDate || req.body?.exp_date, "expDate");
  const mfgDate = toIsoDateOnly(req.body?.mfgDate || req.body?.mfg_date, "mfgDate");
  const manufacturer = normalizeText(req.body?.manufacturer || req.body?.manufacturerName);
  const occurredAt = toIsoTimestamp(req.body?.occurredAt);
  const note = req.body?.note || null;
  const createdByUserId = req.user?.id || req.body?.createdByUserId || null;
  const userRole = normalizeRole(req.user?.role);
  const userLocationId = toNullableText(req.user?.location_id);
  const fromLocationIdInput = toNullableText(req.body?.from_location_id ?? req.body?.fromLocationId);
  const toLocationIdInput = toNullableText(req.body?.to_location_id ?? req.body?.toLocationId);
  const isAdmin = userRole === "ADMIN";

  if (!MOVEMENT_TYPES.has(movementType)) {
    throw httpError(400, `Unsupported movementType: ${movementType || "-"}`);
  }
  if (!productId) throw httpError(400, "productId is required");
  if (!unitLevelIdInput && !unitLabel) {
    throw httpError(400, "unitLevelId or unitLabel is required");
  }
  if (!lotIdInput && !lotNo) throw httpError(400, "lotNo is required");
  if (!lotIdInput && !expDate) throw httpError(400, "expDate is required");

  if (!isAdmin && !userLocationId) {
    throw httpError(403, "Branch-scoped access requires location_id");
  }

  if (!isAdmin) {
    if (movementType === "RECEIVE" && toLocationIdInput && toLocationIdInput !== userLocationId) {
      throw httpError(403, "Forbidden: to_location_id mismatch");
    }
    if (
      (movementType === "TRANSFER_OUT" || movementType === "DISPENSE") &&
      fromLocationIdInput &&
      fromLocationIdInput !== userLocationId
    ) {
      throw httpError(403, "Forbidden: from_location_id mismatch");
    }
  }

  let effectiveFromLocationId = fromLocationIdInput;
  let effectiveToLocationId = toLocationIdInput;

  if (!isAdmin) {
    if (movementType === "RECEIVE") {
      effectiveToLocationId = userLocationId;
    } else if (movementType === "TRANSFER_OUT") {
      effectiveFromLocationId = userLocationId;
    } else if (movementType === "DISPENSE") {
      effectiveFromLocationId = userLocationId;
      effectiveToLocationId = "";
    }
  }

  if (movementType === "RECEIVE" && !effectiveToLocationId) {
    throw httpError(400, "to_location_id is required for RECEIVE");
  }
  if (movementType === "TRANSFER_OUT" && !effectiveFromLocationId) {
    throw httpError(400, "from_location_id is required for TRANSFER_OUT");
  }
  if (movementType === "TRANSFER_OUT" && !effectiveToLocationId) {
    throw httpError(400, "to_location_id is required for TRANSFER_OUT");
  }
  if (movementType === "DISPENSE" && !effectiveFromLocationId) {
    throw httpError(400, "from_location_id is required for DISPENSE");
  }
  if (movementType === "DISPENSE") {
    effectiveToLocationId = "";
  }

  if (
    effectiveFromLocationId &&
    effectiveToLocationId &&
    effectiveFromLocationId === effectiveToLocationId
  ) {
    throw httpError(400, "from_location_id and to_location_id must be different");
  }

  const result = await withTransaction(async (client) => {
    const actorUserId = await resolveActorUserId(client, createdByUserId);
    await ensureProductExists(client, productId);
    const unitLevel = await resolveRequestedUnitLevel(client, {
      productId,
      unitLevelId: unitLevelIdInput,
      unitLabel,
      unitStructure: req.body || {},
    });
    const baseUnitLevel = await resolveProductBaseUnitLevel(client, productId);
    const quantityBase = convertToBase(qty, unitLevel);
    const lotId = await resolveLotIdForMovement(client, {
      productId,
      movementType,
      explicitLotId: lotIdInput || null,
      lotNo,
      expDate,
      mfgDate,
      manufacturer,
    });
    const fromLocation = await resolveActiveLocationById(
      client,
      effectiveFromLocationId,
      "from_location_id"
    );
    const toLocation = await resolveActiveLocationById(client, effectiveToLocationId, "to_location_id");
    let movementCount = 0;

    if (movementType === "RECEIVE") {
      await client.query(
        `
          INSERT INTO stock_movements (
            movement_type,
            from_location_id,
            to_location_id,
            product_id,
            lot_id,
            quantity,
            quantity_base,
            unit_level_id,
            occurred_at,
            created_by,
            note_text
          )
          VALUES (
            'RECEIVE',
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8::timestamptz,
            $9,
            $10
          )
        `,
        [
          fromLocation?.id || null,
          toLocation?.id || null,
          productId,
          lotId,
          qty,
          convertMovementToSignedBase(qty, "RECEIVE", unitLevel),
          unitLevel.id,
          occurredAt,
          actorUserId,
          note,
        ]
      );

      await applyStockDelta(client, {
        branchId: toLocation.id,
        productId,
        lotId,
        baseUnitLevelId: baseUnitLevel.id,
        deltaQtyBase: quantityBase,
      });

      movementCount = 1;
    } else if (movementType === "TRANSFER_OUT") {
      await applyStockDelta(client, {
        branchId: fromLocation.id,
        productId,
        lotId,
        baseUnitLevelId: baseUnitLevel.id,
        deltaQtyBase: -quantityBase,
      });
      await applyStockDelta(client, {
        branchId: toLocation.id,
        productId,
        lotId,
        baseUnitLevelId: baseUnitLevel.id,
        deltaQtyBase: quantityBase,
      });

      await client.query(
        `
          INSERT INTO stock_movements (
            movement_type,
            from_location_id,
            to_location_id,
            product_id,
            lot_id,
            quantity,
            quantity_base,
            unit_level_id,
            occurred_at,
            created_by,
            note_text
          )
          VALUES
            ('TRANSFER_OUT', $1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10),
            ('TRANSFER_IN',  $1, $2, $3, $4, $5, $11, $7, $8::timestamptz, $9, $10)
        `,
        [
          fromLocation.id,
          toLocation.id,
          productId,
          lotId,
          qty,
          convertMovementToSignedBase(qty, "TRANSFER_OUT", unitLevel),
          unitLevel.id,
          occurredAt,
          actorUserId,
          note,
          convertMovementToSignedBase(qty, "TRANSFER_IN", unitLevel),
        ]
      );

      movementCount = 2;
    } else {
      await applyStockDelta(client, {
        branchId: fromLocation.id,
        productId,
        lotId,
        baseUnitLevelId: baseUnitLevel.id,
        deltaQtyBase: -quantityBase,
      });

      await client.query(
        `
          INSERT INTO stock_movements (
            movement_type,
            from_location_id,
            to_location_id,
            product_id,
            lot_id,
            quantity,
            quantity_base,
            unit_level_id,
            occurred_at,
            created_by,
            note_text
          )
          VALUES (
            'DISPENSE',
            $1,
            NULL,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7::timestamptz,
            $8,
            $9
          )
        `,
        [
          fromLocation.id,
          productId,
          lotId,
          qty,
          convertMovementToSignedBase(qty, "DISPENSE", unitLevel),
          unitLevel.id,
          occurredAt,
          actorUserId,
          note,
        ]
      );

      movementCount = 1;
    }

    return {
      movementType,
      movementCount,
      from_location_id: fromLocation?.id || null,
      to_location_id: toLocation?.id || null,
    };
  });

  return res.status(201).json({
    ok: true,
    ...result,
  });
}

export async function listLocations(req, res) {
  const includeInactive = parseBoolean(req.query.includeInactive, false);
  const locationType = normalizeText(req.query.locationType || req.query.type).toUpperCase();
  if (locationType && !LOCATION_TYPES.has(locationType)) {
    throw httpError(400, `Unsupported locationType: ${locationType}`);
  }

  const params = [];
  const where = [];
  if (!includeInactive) {
    where.push("is_active = true");
  }
  if (locationType) {
    params.push(locationType);
    where.push(`location_type = $${params.length}::location_type`);
  }

  const result = await query(
    `
      SELECT
        id,
        code,
        name,
        location_type AS type,
        is_active AS "is_active"
      FROM locations
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY location_type ASC, code ASC, name ASC
    `,
    params
  );

  return res.json(result.rows);
}

export async function getStockOnHand(req, res) {
  const branchCode = String(req.query.branchCode || "").trim();
  const productId = String(req.query.productId || "").trim();

  const params = [];
  const where = ["l.location_type = 'BRANCH'"];
  if (branchCode) {
    params.push(branchCode);
    where.push(`l.code = $${params.length}`);
  }
  if (productId) {
    params.push(productId);
    where.push(`mb.product_id = $${params.length}::uuid`);
  }

  const result = await query(
    `
      WITH movement_branches AS (
        SELECT
          COALESCE(
            CASE
              WHEN sm.quantity_base > 0 THEN sm.to_location_id
              WHEN sm.quantity_base < 0 THEN sm.from_location_id
              ELSE NULL
            END,
            sm.to_location_id,
            sm.from_location_id
          ) AS branch_id,
          sm.product_id,
          sm.lot_id,
          SUM(sm.quantity_base) AS quantity_base
        FROM stock_movements sm
        GROUP BY
          COALESCE(
            CASE
              WHEN sm.quantity_base > 0 THEN sm.to_location_id
              WHEN sm.quantity_base < 0 THEN sm.from_location_id
              ELSE NULL
            END,
            sm.to_location_id,
            sm.from_location_id
          ),
          sm.product_id,
          sm.lot_id
      ),
      base_unit_pick AS (
        SELECT DISTINCT ON (pul.product_id)
          pul.product_id,
          pul.id AS base_unit_level_id,
          pul.code AS base_unit_code,
          pul.display_name AS base_unit_label,
          ut.code AS base_unit_type_code,
          COALESCE(NULLIF(ut.name_th, ''), NULLIF(ut.name_en, ''), NULLIF(ut.symbol, ''), ut.code, 'base') AS base_unit_symbol
        FROM product_unit_levels pul
        LEFT JOIN unit_types ut ON ut.id = pul.unit_type_id
        ORDER BY pul.product_id, pul.is_base DESC, pul.sort_order ASC, pul.created_at ASC
      )
      SELECT
        l.code AS "branchCode",
        l.name AS "branchName",
        p.id AS "productId",
        p.product_code AS "productCode",
        p.trade_name AS "tradeName",
        pl.id AS "lotId",
        pl.lot_no AS "lotNo",
        pl.exp_date AS "expDate",
        mb.quantity_base AS "quantityBase",
        mb.quantity_base AS "quantity",
        COALESCE(bu.base_unit_type_code, bu.base_unit_code, 'BASE') AS "unitCode",
        COALESCE(NULLIF(trim(bu.base_unit_label), ''), bu.base_unit_symbol, 'base') AS "unitLabel",
        bu.base_unit_symbol AS "baseUnitLabel"
      FROM movement_branches mb
      JOIN locations l ON l.id = mb.branch_id
      JOIN products p ON p.id = mb.product_id
      LEFT JOIN product_lots pl ON pl.id = mb.lot_id
      LEFT JOIN base_unit_pick bu ON bu.product_id = mb.product_id
      WHERE ${where.join(" AND ")}
        AND mb.quantity_base > 0
      ORDER BY l.code, p.trade_name, pl.exp_date NULLS LAST, pl.lot_no
    `,
    params
  );

  return res.json(result.rows);
}

export async function updateMovementOccurredAtCorrection(req, res) {
  const movementId = normalizeText(req.params?.id);
  const correctedOccurredAtInput = normalizeText(
    req.body?.correctedOccurredAt ?? req.body?.corrected_occurred_at ?? req.body?.occurredAt
  );
  const reason = requireNonEmptyText(
    req.body?.reason ?? req.body?.reasonText ?? req.body?.reason_text,
    "reason"
  );
  const editedByUserId = req.user?.id || req.body?.editedByUserId || null;

  if (!isUuid(movementId)) {
    throw httpError(400, "movement id must be a valid UUID");
  }
  if (!correctedOccurredAtInput) {
    throw httpError(400, "correctedOccurredAt is required");
  }

  const requestedOccurredAt = toIsoTimestamp(correctedOccurredAtInput);

  const result = await withTransaction(async (client) => {
    const actorUserId = await resolveActorUserId(client, editedByUserId);
    const movementResult = await client.query(
      `
        SELECT
          sm.id,
          sm.movement_type AS "movementType",
          sm.occurred_at AS "originalOccurredAt",
          sm.corrected_occurred_at AS "correctedOccurredAt"
        FROM stock_movements sm
        WHERE sm.id = $1
        LIMIT 1
      `,
      [movementId]
    );

    const movement = movementResult.rows[0];
    if (!movement) {
      throw httpError(404, "Movement not found");
    }
    if (movement.movementType !== "RECEIVE") {
      throw httpError(400, "Only RECEIVE movements support occurred_at correction");
    }

    const originalOccurredAtIso = toExistingIsoTimestamp(
      movement.originalOccurredAt,
      "stock_movements.occurred_at"
    );
    const previousCorrectedOccurredAtIso = movement.correctedOccurredAt
      ? toExistingIsoTimestamp(
          movement.correctedOccurredAt,
          "stock_movements.corrected_occurred_at"
        )
      : null;
    const previousEffectiveOccurredAtIso =
      previousCorrectedOccurredAtIso || originalOccurredAtIso;
    const nextCorrectedOccurredAtIso =
      requestedOccurredAt === originalOccurredAtIso ? null : requestedOccurredAt;
    const nextEffectiveOccurredAtIso =
      nextCorrectedOccurredAtIso || originalOccurredAtIso;

    if (nextEffectiveOccurredAtIso === previousEffectiveOccurredAtIso) {
      throw httpError(400, "No occurredAt change detected");
    }

    await client.query(
      `
        UPDATE stock_movements
        SET corrected_occurred_at = $2::timestamptz
        WHERE id = $1
      `,
      [movementId, nextCorrectedOccurredAtIso]
    );

    await client.query(
      `
        INSERT INTO stock_movement_occurred_at_audits (
          movement_id,
          original_occurred_at,
          previous_corrected_occurred_at,
          previous_effective_occurred_at,
          new_corrected_occurred_at,
          new_effective_occurred_at,
          reason_text,
          edited_by
        )
        VALUES (
          $1,
          $2::timestamptz,
          $3::timestamptz,
          $4::timestamptz,
          $5::timestamptz,
          $6::timestamptz,
          $7,
          $8
        )
      `,
      [
        movementId,
        originalOccurredAtIso,
        previousCorrectedOccurredAtIso,
        previousEffectiveOccurredAtIso,
        nextCorrectedOccurredAtIso,
        nextEffectiveOccurredAtIso,
        reason,
        actorUserId,
      ]
    );

    return {
      id: movementId,
      movementType: movement.movementType,
      originalOccurredAt: originalOccurredAtIso,
      correctedOccurredAt: nextCorrectedOccurredAtIso,
      occurredAt: nextEffectiveOccurredAtIso,
      correctionCleared: nextCorrectedOccurredAtIso === null,
    };
  });

  return res.json({
    ok: true,
    ...result,
  });
}

export async function getMovements(req, res) {
  const productId = req.query.productId ? String(req.query.productId).trim() : "";
  const branchCode = req.query.branchCode ? String(req.query.branchCode).trim() : "";
  const requestedLocationId =
    req.query.location_id || req.query.locationId
      ? String(req.query.location_id || req.query.locationId).trim()
      : "";
  const fromInput = req.query.from ?? req.query.fromDate;
  const toInput = req.query.to ?? req.query.toDate;
  const from = fromInput ? new Date(String(fromInput)) : null;
  const to = toInput ? new Date(String(toInput)) : null;
  const requestedLimit = Number(req.query.limit);
  const safeLimit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 1), 1000)
    : 1000;
  const userRole = String(req.user?.role || "").trim().toUpperCase();
  const userLocationId = req.user?.location_id ? String(req.user.location_id).trim() : "";
  const effectiveLocationId =
    userRole === "ADMIN"
      ? requestedLocationId
      : userLocationId || requestedLocationId;

  if (userRole !== "ADMIN" && requestedLocationId && requestedLocationId !== userLocationId) {
    throw httpError(403, "Forbidden: location filter mismatch");
  }

  if (from && Number.isNaN(from.getTime())) throw httpError(400, "Invalid from datetime");
  if (to && Number.isNaN(to.getTime())) throw httpError(400, "Invalid to datetime");

  const params = [];
  const where = ["1=1"];
  const effectiveOccurredAtSql = "COALESCE(sm.corrected_occurred_at, sm.occurred_at)";

  if (productId) {
    params.push(productId);
    where.push(`sm.product_id = $${params.length}`);
  }

  if (branchCode) {
    params.push(branchCode);
    where.push(`(from_l.code = $${params.length} OR to_l.code = $${params.length})`);
  }

  if (effectiveLocationId) {
    params.push(effectiveLocationId);
    where.push(`(from_l.id = $${params.length}::uuid OR to_l.id = $${params.length}::uuid)`);
  }

  if (from) {
    params.push(from.toISOString());
    where.push(`${effectiveOccurredAtSql} >= $${params.length}::timestamptz`);
  }

  if (to) {
    params.push(to.toISOString());
    where.push(`${effectiveOccurredAtSql} < $${params.length}::timestamptz`);
  }

  params.push(safeLimit);

  const result = await query(
    `
      SELECT
        sm.id,
        sm.movement_type AS "movementType",
        ${effectiveOccurredAtSql} AS "occurredAt",
        sm.occurred_at AS "originalOccurredAt",
        sm.corrected_occurred_at AS "correctedOccurredAt",
        sm.quantity,
        sm.quantity_base AS "quantityBase",
        sm.note_text AS note,
        p.id AS "productId",
        p.product_code AS "productCode",
        p.trade_name AS "tradeName",
        pl.id AS "lotId",
        pl.lot_no AS "lotNo",
        COALESCE(NULLIF(trim(sellable_pul.display_name), ''), sellable_pul.code, COALESCE(NULLIF(trim(pul.display_name), ''), pul.code, 'unit')) AS "unitLabel",
        COALESCE(NULLIF(trim(pul.display_name), ''), pul.code, 'unit') AS "movementUnitLabel",
        COALESCE(NULLIF(trim(sellable_pul.display_name), ''), sellable_pul.code, COALESCE(NULLIF(trim(pul.display_name), ''), pul.code, 'unit')) AS "sellableUnitLabel",
        COALESCE(base_pul.base_unit_symbol, 'base') AS "baseUnitLabel",
        latest_correction.reason_text AS "occurredAtCorrectionReason",
        latest_correction.edited_at AS "occurredAtCorrectedAt",
        latest_correction.edited_by_name AS "occurredAtCorrectedByName",
        latest_correction.edited_by_username AS "occurredAtCorrectedByUsername",
        from_l.code AS "fromBranchCode",
        from_l.name AS "fromBranchName",
        to_l.code AS "toBranchCode",
        to_l.name AS "toBranchName"
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      LEFT JOIN product_lots pl ON pl.id = sm.lot_id
      JOIN product_unit_levels pul ON pul.id = sm.unit_level_id
      LEFT JOIN LATERAL (
        SELECT
          puls.display_name,
          puls.code
        FROM product_unit_levels puls
        WHERE puls.product_id = sm.product_id
        ORDER BY puls.is_sellable DESC, puls.is_base DESC, puls.sort_order ASC, puls.created_at ASC
        LIMIT 1
      ) sellable_pul ON true
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(NULLIF(utb.name_th, ''), NULLIF(utb.name_en, ''), NULLIF(utb.symbol, ''), utb.code, 'base') AS base_unit_symbol
        FROM product_unit_levels pulb
        LEFT JOIN unit_types utb ON utb.id = pulb.unit_type_id
        WHERE pulb.product_id = sm.product_id
        ORDER BY pulb.is_base DESC, pulb.sort_order ASC, pulb.created_at ASC
        LIMIT 1
      ) base_pul ON true
      LEFT JOIN LATERAL (
        SELECT
          sma.reason_text,
          sma.edited_at,
          COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), ''), 'unknown') AS edited_by_name,
          u.username AS edited_by_username
        FROM stock_movement_occurred_at_audits sma
        LEFT JOIN users u ON u.id = sma.edited_by
        WHERE sma.movement_id = sm.id
        ORDER BY sma.edited_at DESC
        LIMIT 1
      ) latest_correction ON true
      LEFT JOIN locations from_l ON from_l.id = sm.from_location_id
      LEFT JOIN locations to_l ON to_l.id = sm.to_location_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${effectiveOccurredAtSql} DESC, sm.created_at DESC
      LIMIT $${params.length}
    `,
    params
  );

  return res.json(result.rows);
}
