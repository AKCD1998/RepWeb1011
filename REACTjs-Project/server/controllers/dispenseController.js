import { query, withTransaction } from "../db/pool.js";
import {
  applyStockDelta,
  assertLotBelongsToProduct,
  ensureProductExists,
  ensureProductUnitLevel,
  resolveActorUserId,
  resolveBranchByCode,
  toIsoTimestamp,
  toPositiveNumeric,
  upsertPatientByPid,
} from "./helpers.js";
import { httpError } from "../utils/httpError.js";

export async function createDispense(req, res) {
  const branchCode = String(req.body?.branchCode || "").trim();
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const patient = req.body?.patient || {};
  const pharmacistUserIdInput = req.body?.pharmacistUserId || null;
  const occurredAt = toIsoTimestamp(req.body?.occurredAt);
  const note = req.body?.note || null;

  if (!branchCode) throw httpError(400, "branchCode is required");
  if (!lines.length) throw httpError(400, "lines must contain at least one item");

  const result = await withTransaction(async (client) => {
    const branch = await resolveBranchByCode(client, branchCode);
    const pharmacistUserId = await resolveActorUserId(client, pharmacistUserIdInput);
    const patientId = await upsertPatientByPid(client, patient);

    const headerResult = await client.query(
      `
        INSERT INTO dispense_headers (
          branch_id,
          patient_id,
          pharmacist_user_id,
          dispensed_at,
          note_text,
          created_by,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4::timestamptz, $5, $3, now(), now())
        RETURNING id
      `,
      [branch.id, patientId, pharmacistUserId, occurredAt, note]
    );
    const headerId = headerResult.rows[0].id;

    const insertedLines = [];
    let lineNo = 1;

    for (const line of lines) {
      const productId = line?.productId;
      const qty = toPositiveNumeric(line?.qty, "qty");
      const unitLabel = String(line?.unitLabel || "").trim();
      if (!unitLabel) throw httpError(400, "unitLabel is required");

      await ensureProductExists(client, productId);
      const unitLevel = await ensureProductUnitLevel(client, productId, unitLabel);

      const lotId = line?.lotId || null;
      if (lotId) {
        await assertLotBelongsToProduct(client, productId, lotId);
      }

      const lineResult = await client.query(
        `
          INSERT INTO dispense_lines (
            header_id,
            line_no,
            product_id,
            lot_id,
            unit_level_id,
            quantity,
            note_text
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `,
        [headerId, lineNo, productId, lotId, unitLevel.id, qty, line?.note || null]
      );
      const dispenseLineId = lineResult.rows[0].id;

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
            dispense_line_id,
            source_ref_type,
            source_ref_id,
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
            'DISPENSE_HEADER',
            $7,
            $8::timestamptz,
            $9,
            $10
          )
        `,
        [
          branch.id,
          productId,
          lotId,
          qty,
          unitLevel.id,
          dispenseLineId,
          headerId,
          occurredAt,
          pharmacistUserId,
          note,
        ]
      );

      await applyStockDelta(client, {
        branchId: branch.id,
        productId,
        lotId,
        unitLevelId: unitLevel.id,
        deltaQty: -qty,
      });

      insertedLines.push({
        id: dispenseLineId,
        lineNo,
        productId,
        lotId,
        quantity: qty,
        unitLabel,
      });

      lineNo += 1;
    }

    return {
      headerId,
      branchCode: branch.code,
      patientId,
      lineCount: insertedLines.length,
      lines: insertedLines,
    };
  });

  return res.status(201).json({
    ok: true,
    ...result,
  });
}

export async function getPatientDispenseHistory(req, res) {
  const pid = String(req.params.pid || "").trim();
  if (!pid) throw httpError(400, "pid is required");

  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  if (from && Number.isNaN(from.getTime())) throw httpError(400, "Invalid from datetime");
  if (to && Number.isNaN(to.getTime())) throw httpError(400, "Invalid to datetime");

  const params = [pid];
  const where = ["pa.pid = $1"];

  if (from) {
    params.push(from.toISOString());
    where.push(`dh.dispensed_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to.toISOString());
    where.push(`dh.dispensed_at < $${params.length}::timestamptz`);
  }

  const result = await query(
    `
      SELECT
        dh.id AS "headerId",
        dh.dispensed_at AS "dispensedAt",
        pa.pid,
        pa.full_name AS "patientName",
        l.code AS "branchCode",
        l.name AS "branchName",
        p.id AS "productId",
        p.product_code AS "productCode",
        p.trade_name AS "tradeName",
        dl.quantity,
        pul.display_name AS "unitLabel",
        pl.lot_no AS "lotNo",
        dl.note_text AS "lineNote",
        dh.note_text AS "headerNote"
      FROM dispense_headers dh
      JOIN patients pa ON pa.id = dh.patient_id
      JOIN locations l ON l.id = dh.branch_id
      JOIN dispense_lines dl ON dl.header_id = dh.id
      JOIN products p ON p.id = dl.product_id
      JOIN product_unit_levels pul ON pul.id = dl.unit_level_id
      LEFT JOIN product_lots pl ON pl.id = dl.lot_id
      WHERE ${where.join(" AND ")}
      ORDER BY dh.dispensed_at DESC, dl.line_no
      LIMIT 1000
    `,
    params
  );

  return res.json(result.rows);
}
