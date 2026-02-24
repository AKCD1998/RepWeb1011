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

export async function receiveInventory(req, res) {
  const toBranchCode = String(req.body?.toBranchCode || "").trim();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const occurredAt = toIsoTimestamp(req.body?.occurredAt);
  const note = req.body?.note || null;
  const createdByUserId = req.body?.createdByUserId || null;

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
  const createdByUserId = req.body?.createdByUserId || null;

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
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;

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

  if (from) {
    params.push(from.toISOString());
    where.push(`sm.occurred_at >= $${params.length}::timestamptz`);
  }

  if (to) {
    params.push(to.toISOString());
    where.push(`sm.occurred_at < $${params.length}::timestamptz`);
  }

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
      LIMIT 1000
    `,
    params
  );

  return res.json(result.rows);
}
