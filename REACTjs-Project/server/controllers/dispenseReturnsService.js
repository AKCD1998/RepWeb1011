import {
  applyStockDelta,
  convertToBase,
  resolveActorUserId,
  resolveBranchById,
  resolveProductBaseUnitLevel,
  toPositiveNumeric,
} from "./helpers.js";
import { httpError } from "../utils/httpError.js";

function toCleanText(value) {
  return String(value ?? "").trim();
}

function normalizeRole(value) {
  return toCleanText(value).toUpperCase();
}

function toOptionalIsoTimestamp(value, fieldName) {
  const text = toCleanText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw httpError(400, `Invalid ${fieldName}`);
  }
  return parsed.toISOString();
}

function formatQuantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return Number.isInteger(numeric)
    ? String(numeric)
    : numeric.toFixed(6).replace(/\.?0+$/, "");
}

function buildReturnStatus(dispensedQuantity, returnedQuantity) {
  const dispensed = Number(dispensedQuantity || 0);
  const returned = Number(returnedQuantity || 0);
  if (returned <= 0) return "ACTIVE";
  if (returned + 0.000001 >= dispensed) return "RETURNED";
  return "PARTIALLY_RETURNED";
}

function buildReturnMovementNote(detail, { reasonText = "", noteText = "", returnSource = "" } = {}) {
  const parts = [
    `Dispense return for header ${detail.headerId}`,
    `line ${detail.lineNo}`,
    `product ${detail.productCode || detail.tradeName || "-"}`,
    `PID ${detail.patientPid || "-"}`,
    `branch ${detail.branchCode || "-"}`,
  ];
  const safeReason = toCleanText(reasonText);
  const safeNote = toCleanText(noteText);
  const safeSource = toCleanText(returnSource).toUpperCase();
  if (safeReason) parts.push(`reason=${safeReason}`);
  if (safeSource) parts.push(`source=${safeSource}`);
  if (safeNote) parts.push(`note=${safeNote}`);
  return parts.join(" | ");
}

export async function getDispenseLineReturnDetail(client, dispenseLineId, { forUpdate = false } = {}) {
  const safeDispenseLineId = toCleanText(dispenseLineId);
  if (!safeDispenseLineId) {
    throw httpError(400, "dispenseLineId is required");
  }

  const result = await client.query(
    `
      SELECT
        dh.id AS "headerId",
        dh.dispensed_at AS "dispensedAt",
        dh.note_text AS "headerNote",
        dh.branch_id AS "branchId",
        l.code AS "branchCode",
        l.name AS "branchName",
        dl.id AS "lineId",
        dl.line_no AS "lineNo",
        dl.quantity AS "dispensedQuantity",
        dl.note_text AS "lineNote",
        dl.product_id AS "productId",
        dl.lot_id AS "lotId",
        dl.unit_level_id AS "unitLevelId",
        p.product_code AS "productCode",
        p.trade_name AS "tradeName",
        pl.lot_no AS "lotNo",
        pul.display_name AS "unitLabel",
        pul.code AS "unitCode",
        pul.unit_key AS "unitKey",
        pa.pid AS "patientPid",
        pa.full_name AS "patientName"
      FROM dispense_lines dl
      JOIN dispense_headers dh ON dh.id = dl.header_id
      JOIN locations l ON l.id = dh.branch_id
      JOIN products p ON p.id = dl.product_id
      JOIN product_unit_levels pul ON pul.id = dl.unit_level_id
      LEFT JOIN product_lots pl ON pl.id = dl.lot_id
      LEFT JOIN patients pa ON pa.id = dh.patient_id
      WHERE dl.id = $1::uuid
      ${forUpdate ? "FOR UPDATE OF dl, dh" : ""}
      LIMIT 1
    `,
    [safeDispenseLineId]
  );

  if (!result.rows[0]) {
    throw httpError(404, "Dispense line not found");
  }

  return result.rows[0];
}

export async function getDispenseLineReturnSummary(client, dispenseLineId) {
  const result = await client.query(
    `
      SELECT
        COALESCE(SUM(returned_quantity), 0) AS "returnedQuantity",
        COALESCE(SUM(returned_quantity_base), 0) AS "returnedQuantityBase",
        MAX(returned_at) AS "lastReturnedAt"
      FROM dispense_returns
      WHERE dispense_line_id = $1::uuid
    `,
    [dispenseLineId]
  );

  return {
    returnedQuantity: Number(result.rows[0]?.returnedQuantity || 0),
    returnedQuantityBase: Number(result.rows[0]?.returnedQuantityBase || 0),
    lastReturnedAt: result.rows[0]?.lastReturnedAt || null,
  };
}

export async function listDispenseReturnCandidates(client, filters = {}) {
  const where = [];
  const params = [];

  const pid = toCleanText(filters?.pid);
  const branchCode = toCleanText(filters?.branchCode);
  const productCode = toCleanText(filters?.productCode);
  const productName = toCleanText(filters?.productName);
  const lotNo = toCleanText(filters?.lotNo);
  const lineId = toCleanText(filters?.dispenseLineId);
  const headerId = toCleanText(filters?.dispenseHeaderId);
  const dateFrom = toOptionalIsoTimestamp(filters?.dateFrom, "dateFrom");
  const dateTo = toOptionalIsoTimestamp(filters?.dateTo, "dateTo");

  if (pid) {
    params.push(pid);
    where.push(`pa.pid = $${params.length}`);
  }
  if (branchCode) {
    params.push(branchCode);
    where.push(`l.code = $${params.length}`);
  }
  if (productCode) {
    params.push(productCode);
    where.push(`p.product_code = $${params.length}`);
  }
  if (productName) {
    params.push(`%${productName}%`);
    where.push(`p.trade_name ILIKE $${params.length}`);
  }
  if (lotNo) {
    params.push(lotNo);
    where.push(`COALESCE(pl.lot_no, '') = $${params.length}`);
  }
  if (lineId) {
    params.push(lineId);
    where.push(`dl.id = $${params.length}::uuid`);
  }
  if (headerId) {
    params.push(headerId);
    where.push(`dh.id = $${params.length}::uuid`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    where.push(`dh.dispensed_at >= $${params.length}::timestamptz`);
  }
  if (dateTo) {
    params.push(dateTo);
    where.push(`dh.dispensed_at <= $${params.length}::timestamptz`);
  }

  const result = await client.query(
    `
      SELECT
        dh.id AS "headerId",
        dh.dispensed_at AS "dispensedAt",
        l.code AS "branchCode",
        l.name AS "branchName",
        dl.id AS "lineId",
        dl.line_no AS "lineNo",
        dl.quantity AS "dispensedQuantity",
        p.product_code AS "productCode",
        p.trade_name AS "tradeName",
        pl.lot_no AS "lotNo",
        pa.pid AS "patientPid",
        pa.full_name AS "patientName",
        COALESCE(rs.returned_quantity, 0) AS "returnedQuantity",
        GREATEST(dl.quantity - COALESCE(rs.returned_quantity, 0), 0) AS "remainingQuantity"
      FROM dispense_lines dl
      JOIN dispense_headers dh ON dh.id = dl.header_id
      JOIN locations l ON l.id = dh.branch_id
      JOIN products p ON p.id = dl.product_id
      LEFT JOIN product_lots pl ON pl.id = dl.lot_id
      LEFT JOIN patients pa ON pa.id = dh.patient_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(dr.returned_quantity), 0) AS returned_quantity
        FROM dispense_returns dr
        WHERE dr.dispense_line_id = dl.id
      ) rs ON true
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY dh.dispensed_at DESC, dl.line_no ASC
      LIMIT 200
    `,
    params
  );

  return result.rows.map((row) => ({
    ...row,
    returnStatus: buildReturnStatus(row.dispensedQuantity, row.returnedQuantity),
  }));
}

export async function createDispenseReturn(client, payload = {}) {
  const dispenseLineId = toCleanText(payload?.dispenseLineId);
  const dispenseHeaderId = toCleanText(payload?.dispenseHeaderId);
  const expectedPatientPid = toCleanText(payload?.patientPid);
  const expectedBranchCode = toCleanText(payload?.branchCode);
  const expectedProductCode = toCleanText(payload?.productCode);
  const expectedLotNo = toCleanText(payload?.lotNo);
  const reasonText = toCleanText(payload?.reason);
  const noteText = toCleanText(payload?.noteText);
  const returnSource = toCleanText(payload?.returnSource).toUpperCase() || "DELIVER_UI";
  const referenceKey = toCleanText(payload?.referenceKey);
  const returnedAt = toOptionalIsoTimestamp(payload?.returnedAt, "returnedAt") || new Date().toISOString();
  const returnedByUserId = await resolveActorUserId(client, payload?.returnedByUserId);

  const detail = await getDispenseLineReturnDetail(client, dispenseLineId, { forUpdate: true });

  if (dispenseHeaderId && detail.headerId !== dispenseHeaderId) {
    throw httpError(409, "dispenseHeaderId does not match the selected dispense line");
  }
  if (expectedPatientPid && toCleanText(detail.patientPid) !== expectedPatientPid) {
    throw httpError(409, "patientPid does not match the selected dispense line");
  }
  if (expectedBranchCode && toCleanText(detail.branchCode) !== expectedBranchCode) {
    throw httpError(409, "branchCode does not match the selected dispense line");
  }
  if (expectedProductCode && toCleanText(detail.productCode) !== expectedProductCode) {
    throw httpError(409, "productCode does not match the selected dispense line");
  }
  if (expectedLotNo && toCleanText(detail.lotNo) !== expectedLotNo) {
    throw httpError(409, "lotNo does not match the selected dispense line");
  }

  if (referenceKey) {
    const existingByReference = await client.query(
      `
        SELECT id, stock_movement_id AS "stockMovementId"
        FROM dispense_returns
        WHERE dispense_line_id = $1::uuid
          AND reference_key = $2
        LIMIT 1
      `,
      [detail.lineId, referenceKey]
    );
    if (existingByReference.rows[0]) {
      throw httpError(409, "This return reference has already been processed");
    }
  }

  const returnSummary = await getDispenseLineReturnSummary(client, detail.lineId);
  const dispensedQuantity = Number(detail.dispensedQuantity || 0);
  const remainingQuantity = Math.max(0, dispensedQuantity - returnSummary.returnedQuantity);
  if (remainingQuantity <= 0) {
    throw httpError(409, "This dispense line has already been fully returned");
  }

  const requestedQuantity = payload?.returnedQuantity
    ? toPositiveNumeric(payload.returnedQuantity, "returnedQuantity")
    : remainingQuantity;

  if (requestedQuantity - remainingQuantity > 0.000001) {
    throw httpError(
      409,
      `returnedQuantity exceeds remaining returnable quantity (${formatQuantity(remainingQuantity)})`
    );
  }

  const unitLevel = {
    id: detail.unitLevelId,
    code: detail.unitCode,
    display_name: detail.unitLabel,
    displayName: detail.unitLabel,
    unit_key: detail.unitKey,
  };
  const returnedQuantityBase = convertToBase(requestedQuantity, unitLevel);
  const baseUnitLevel = await resolveProductBaseUnitLevel(client, detail.productId);
  const branch = await resolveBranchById(client, detail.branchId);

  const insertReturnResult = await client.query(
    `
      INSERT INTO dispense_returns (
        dispense_header_id,
        dispense_line_id,
        branch_id,
        product_id,
        lot_id,
        unit_level_id,
        returned_quantity,
        returned_quantity_base,
        reason_text,
        note_text,
        return_source,
        reference_key,
        returned_by,
        returned_at,
        created_at
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::uuid,
        $5::uuid,
        $6::uuid,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13::uuid,
        $14::timestamptz,
        now()
      )
      RETURNING id
    `,
    [
      detail.headerId,
      detail.lineId,
      detail.branchId,
      detail.productId,
      detail.lotId || null,
      detail.unitLevelId,
      requestedQuantity,
      returnedQuantityBase,
      reasonText || null,
      noteText || null,
      returnSource,
      referenceKey || null,
      returnedByUserId,
      returnedAt,
    ]
  );
  const returnId = insertReturnResult.rows[0].id;

  const movementNote = buildReturnMovementNote(detail, {
    reasonText,
    noteText,
    returnSource,
  });

  const movementResult = await client.query(
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
        dispense_line_id,
        source_ref_type,
        source_ref_id,
        occurred_at,
        created_by,
        note_text
      )
      VALUES (
        'ADJUST',
        NULL,
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4,
        $5,
        $6::uuid,
        $7::uuid,
        'DISPENSE_RETURN',
        $8::uuid,
        $9::timestamptz,
        $10::uuid,
        $11
      )
      RETURNING id
    `,
    [
      detail.branchId,
      detail.productId,
      detail.lotId || null,
      requestedQuantity,
      returnedQuantityBase,
      detail.unitLevelId,
      detail.lineId,
      returnId,
      returnedAt,
      returnedByUserId,
      movementNote,
    ]
  );
  const stockMovementId = movementResult.rows[0].id;

  await client.query(
    `
      UPDATE dispense_returns
      SET stock_movement_id = $2::uuid
      WHERE id = $1::uuid
    `,
    [returnId, stockMovementId]
  );

  await applyStockDelta(client, {
    branchId: detail.branchId,
    productId: detail.productId,
    lotId: detail.lotId || null,
    baseUnitLevelId: baseUnitLevel.id,
    deltaQtyBase: returnedQuantityBase,
  });

  const nextReturnedQuantity = returnSummary.returnedQuantity + requestedQuantity;
  const nextRemainingQuantity = Math.max(0, dispensedQuantity - nextReturnedQuantity);

  return {
    returnId,
    stockMovementId,
    dispenseHeaderId: detail.headerId,
    dispenseLineId: detail.lineId,
    branchId: branch.id,
    branchCode: branch.code,
    branchName: branch.name,
    productId: detail.productId,
    productCode: detail.productCode,
    tradeName: detail.tradeName,
    lotId: detail.lotId || null,
    lotNo: detail.lotNo || null,
    patientPid: detail.patientPid || null,
    patientName: detail.patientName || null,
    dispensedQuantity,
    returnedQuantity: requestedQuantity,
    returnedQuantityBase,
    totalReturnedQuantity: nextReturnedQuantity,
    remainingQuantity: nextRemainingQuantity,
    returnStatus: buildReturnStatus(dispensedQuantity, nextReturnedQuantity),
    returnedAt,
    returnSource,
  };
}

export async function assertUserCanReturnDispenseLine(client, user = {}, branchId) {
  const role = normalizeRole(user?.role);
  if (role === "ADMIN") return;

  const userBranch = await resolveBranchById(client, user?.location_id);
  if (userBranch.id !== branchId) {
    throw httpError(403, "Forbidden: dispense line belongs to another branch");
  }
}
