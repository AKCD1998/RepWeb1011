import { query, withTransaction } from "../db/pool.js";
import {
  applyStockDelta,
  assertLotBelongsToProduct,
  ensureLot,
  ensureProductExists,
  ensureProductUnitLevel,
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

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
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
      const unitLabel = String(item?.unitLabel || "").trim();
      if (!unitLabel) throw httpError(400, "unitLabel is required");

      await ensureProductExists(client, productId);
      const unitLevel = await ensureProductUnitLevel(client, productId, unitLabel);

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
            $6::timestamptz,
            $7,
            $8
          )
        `,
        [branch.id, productId, lotId || null, qty, unitLevel.id, occurredAt, actorUserId, note]
      );

      await applyStockDelta(client, {
        branchId: branch.id,
        productId,
        lotId: lotId || null,
        unitLevelId: unitLevel.id,
        deltaQty: qty,
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
      const unitLabel = String(item?.unitLabel || "").trim();
      if (!unitLabel) throw httpError(400, "unitLabel is required");

      await ensureProductExists(client, productId);
      const unitLevel = await ensureProductUnitLevel(client, productId, unitLabel);
      const lotId = item?.lotId || null;
      if (lotId) {
        await assertLotBelongsToProduct(client, productId, lotId);
      }

      await applyStockDelta(client, {
        branchId: fromBranch.id,
        productId,
        lotId,
        unitLevelId: unitLevel.id,
        deltaQty: -qty,
      });
      await applyStockDelta(client, {
        branchId: toBranch.id,
        productId,
        lotId,
        unitLevelId: unitLevel.id,
        deltaQty: qty,
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
            unit_level_id,
            occurred_at,
            created_by,
            note_text
          )
          VALUES
            ('TRANSFER_OUT', $1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9),
            ('TRANSFER_IN',  $1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9)
        `,
        [fromBranch.id, toBranch.id, productId, lotId, qty, unitLevel.id, occurredAt, actorUserId, note]
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
  const unitLabel = normalizeText(req.body?.unitLabel || req.body?.unit);
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
  if (!unitLabel) throw httpError(400, "unitLabel is required");

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
    const unitLevel = await ensureProductUnitLevel(client, productId, unitLabel);
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
            NULL,
            $4,
            $5,
            $6::timestamptz,
            $7,
            $8
          )
        `,
        [fromLocation?.id || null, toLocation?.id || null, productId, qty, unitLevel.id, occurredAt, actorUserId, note]
      );

      await applyStockDelta(client, {
        branchId: toLocation.id,
        productId,
        lotId: null,
        unitLevelId: unitLevel.id,
        deltaQty: qty,
      });

      movementCount = 1;
    } else if (movementType === "TRANSFER_OUT") {
      await applyStockDelta(client, {
        branchId: fromLocation.id,
        productId,
        lotId: null,
        unitLevelId: unitLevel.id,
        deltaQty: -qty,
      });
      await applyStockDelta(client, {
        branchId: toLocation.id,
        productId,
        lotId: null,
        unitLevelId: unitLevel.id,
        deltaQty: qty,
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
            unit_level_id,
            occurred_at,
            created_by,
            note_text
          )
          VALUES
            ('TRANSFER_OUT', $1, $2, $3, NULL, $4, $5, $6::timestamptz, $7, $8),
            ('TRANSFER_IN',  $1, $2, $3, NULL, $4, $5, $6::timestamptz, $7, $8)
        `,
        [fromLocation.id, toLocation.id, productId, qty, unitLevel.id, occurredAt, actorUserId, note]
      );

      movementCount = 2;
    } else {
      await applyStockDelta(client, {
        branchId: fromLocation.id,
        productId,
        lotId: null,
        unitLevelId: unitLevel.id,
        deltaQty: -qty,
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
            NULL,
            $3,
            $4,
            $5::timestamptz,
            $6,
            $7
          )
        `,
        [fromLocation.id, productId, qty, unitLevel.id, occurredAt, actorUserId, note]
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

  const params = [];
  const where = ["l.location_type = 'BRANCH'"];
  if (branchCode) {
    params.push(branchCode);
    where.push(`l.code = $${params.length}`);
  }

  const result = await query(
    `
      SELECT
        l.code AS "branchCode",
        l.name AS "branchName",
        p.id AS "productId",
        p.product_code AS "productCode",
        p.trade_name AS "tradeName",
        pl.id AS "lotId",
        pl.lot_no AS "lotNo",
        pl.exp_date AS "expDate",
        soh.quantity_on_hand AS "quantity",
        pul.code AS "unitCode",
        pul.display_name AS "unitLabel"
      FROM stock_on_hand soh
      JOIN locations l ON l.id = soh.branch_id
      JOIN products p ON p.id = soh.product_id
      LEFT JOIN product_lots pl ON pl.id = soh.lot_id
      JOIN product_unit_levels pul ON pul.id = soh.base_unit_level_id
      WHERE ${where.join(" AND ")}
      ORDER BY l.code, p.trade_name, pl.exp_date NULLS LAST, pl.lot_no
    `,
    params
  );

  return res.json(result.rows);
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
    where.push(`sm.occurred_at >= $${params.length}::timestamptz`);
  }

  if (to) {
    params.push(to.toISOString());
    where.push(`sm.occurred_at < $${params.length}::timestamptz`);
  }

  params.push(safeLimit);

  const result = await query(
    `
      SELECT
        sm.id,
        sm.movement_type AS "movementType",
        sm.occurred_at AS "occurredAt",
        sm.quantity,
        sm.note_text AS note,
        p.id AS "productId",
        p.product_code AS "productCode",
        p.trade_name AS "tradeName",
        pl.id AS "lotId",
        pl.lot_no AS "lotNo",
        pul.display_name AS "unitLabel",
        from_l.code AS "fromBranchCode",
        from_l.name AS "fromBranchName",
        to_l.code AS "toBranchCode",
        to_l.name AS "toBranchName"
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      LEFT JOIN product_lots pl ON pl.id = sm.lot_id
      JOIN product_unit_levels pul ON pul.id = sm.unit_level_id
      LEFT JOIN locations from_l ON from_l.id = sm.from_location_id
      LEFT JOIN locations to_l ON to_l.id = sm.to_location_id
      WHERE ${where.join(" AND ")}
      ORDER BY sm.occurred_at DESC, sm.created_at DESC
      LIMIT $${params.length}
    `,
    params
  );

  return res.json(result.rows);
}
