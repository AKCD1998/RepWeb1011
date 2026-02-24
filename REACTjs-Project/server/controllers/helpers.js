import { httpError } from "../utils/httpError.js";

const SYSTEM_USERNAME = "system";
const DEFAULT_SYSTEM_PASSWORD_HASH = "$2b$10$M2M6PmdM1Q9hIBDwa7Jx0u2fBw8LZg/XiP7nM7G0X2j4VdZG2M53a";

function normalizeUnitCode(unitLabel) {
  return String(unitLabel || "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function unitKindFromCode(code) {
  if (["MG", "MCG", "G"].includes(code)) return "MASS";
  if (["ML", "L"].includes(code)) return "VOLUME";
  if (["TABLET", "CAPSULE", "TAB", "CAP", "INHALATION"].includes(code)) return "COUNT";
  return "PACKAGE";
}

export function toIsoTimestamp(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw httpError(400, "Invalid datetime value");
  }
  return date.toISOString();
}

export function toPositiveNumeric(value, fieldName) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw httpError(400, `${fieldName} must be a positive number`);
  }
  return numericValue;
}

export async function resolveBranchByCode(client, branchCode) {
  const code = String(branchCode || "").trim();
  if (!code) throw httpError(400, "branchCode is required");

  const result = await client.query(
    `
      SELECT id, code, name
      FROM locations
      WHERE code = $1
        AND location_type = 'BRANCH'
        AND is_active = true
      LIMIT 1
    `,
    [code]
  );

  if (!result.rows[0]) {
    throw httpError(404, `Branch not found: ${code}`);
  }

  return result.rows[0];
}

export async function ensureProductExists(client, productId) {
  if (!productId) throw httpError(400, "productId is required");
  const result = await client.query(
    `
      SELECT id, trade_name
      FROM products
      WHERE id = $1
      LIMIT 1
    `,
    [productId]
  );

  if (!result.rows[0]) {
    throw httpError(404, `Product not found: ${productId}`);
  }

  return result.rows[0];
}

export async function resolveActorUserId(client, explicitUserId) {
  if (explicitUserId) {
    const existing = await client.query(
      `
        SELECT id
        FROM users
        WHERE id = $1
          AND is_active = true
        LIMIT 1
      `,
      [explicitUserId]
    );
    if (!existing.rows[0]) {
      throw httpError(404, `User not found: ${explicitUserId}`);
    }
    return existing.rows[0].id;
  }

  const existingSystem = await client.query(
    `
      SELECT id
      FROM users
      WHERE username = $1
      LIMIT 1
    `,
    [SYSTEM_USERNAME]
  );

  if (existingSystem.rows[0]) {
    return existingSystem.rows[0].id;
  }

  const created = await client.query(
    `
      INSERT INTO users (username, password_hash, full_name, role, is_active)
      VALUES ($1, $2, $3, 'ADMIN', true)
      RETURNING id
    `,
    [SYSTEM_USERNAME, DEFAULT_SYSTEM_PASSWORD_HASH, "System User"]
  );

  return created.rows[0].id;
}

export async function ensureUnitType(client, unitLabel) {
  const rawLabel = String(unitLabel || "").trim();
  if (!rawLabel) throw httpError(400, "unitLabel is required");
  const code = normalizeUnitCode(rawLabel);
  if (!code) throw httpError(400, "unitLabel is invalid");

  const existing = await client.query(
    `
      SELECT id, code
      FROM unit_types
      WHERE code = $1
      LIMIT 1
    `,
    [code]
  );

  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(
    `
      INSERT INTO unit_types (code, name_en, name_th, unit_kind, symbol, precision_scale, is_active)
      VALUES ($1, $2, $2, $3, $4, 3, true)
      RETURNING id, code
    `,
    [code, rawLabel, unitKindFromCode(code), rawLabel]
  );

  return inserted.rows[0];
}

export async function ensureProductUnitLevel(client, productId, unitLabel) {
  const unit = await ensureUnitType(client, unitLabel);
  const code = unit.code;
  const displayName = String(unitLabel || "").trim();

  const existing = await client.query(
    `
      SELECT id, code, unit_type_id
      FROM product_unit_levels
      WHERE product_id = $1
        AND code = $2
      LIMIT 1
    `,
    [productId, code]
  );

  if (existing.rows[0]) return existing.rows[0];

  const orderResult = await client.query(
    `
      SELECT
        COALESCE(MAX(sort_order), 0) AS max_order,
        COUNT(*)::int AS level_count
      FROM product_unit_levels
      WHERE product_id = $1
    `,
    [productId]
  );
  const maxOrder = Number(orderResult.rows[0]?.max_order || 0);
  const levelCount = Number(orderResult.rows[0]?.level_count || 0);

  const inserted = await client.query(
    `
      INSERT INTO product_unit_levels (
        product_id,
        code,
        display_name,
        unit_type_id,
        is_base,
        is_sellable,
        sort_order
      )
      VALUES ($1, $2, $3, $4, $5, true, $6)
      RETURNING id, code, unit_type_id
    `,
    [productId, code, displayName, unit.id, levelCount === 0, maxOrder + 1]
  );

  return inserted.rows[0];
}

export async function ensureLot(client, { productId, lotNo, mfgDate, expDate, manufacturer }) {
  const safeLotNo = String(lotNo || "").trim();
  if (!safeLotNo) throw httpError(400, "lotNo is required");
  if (!expDate) throw httpError(400, "expDate is required for receiving");

  const existing = await client.query(
    `
      SELECT id
      FROM product_lots
      WHERE product_id = $1
        AND lot_no = $2
        AND exp_date = $3::date
      LIMIT 1
    `,
    [productId, safeLotNo, expDate]
  );

  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await client.query(
    `
      INSERT INTO product_lots (
        product_id,
        lot_no,
        mfg_date,
        exp_date,
        manufacturer_name
      )
      VALUES ($1, $2, $3::date, $4::date, $5)
      RETURNING id
    `,
    [productId, safeLotNo, mfgDate || null, expDate, manufacturer || null]
  );

  return inserted.rows[0].id;
}

export async function assertLotBelongsToProduct(client, productId, lotId) {
  if (!lotId) return;
  const result = await client.query(
    `
      SELECT id
      FROM product_lots
      WHERE id = $1
        AND product_id = $2
      LIMIT 1
    `,
    [lotId, productId]
  );

  if (!result.rows[0]) {
    throw httpError(400, `lotId ${lotId} does not belong to product ${productId}`);
  }
}

export async function applyStockDelta(client, { branchId, productId, lotId, unitLevelId, deltaQty }) {
  if (!Number.isFinite(deltaQty) || deltaQty === 0) return;

  const existing = await client.query(
    `
      SELECT id, quantity_on_hand
      FROM stock_on_hand
      WHERE branch_id = $1
        AND product_id = $2
        AND base_unit_level_id = $3
        AND lot_id IS NOT DISTINCT FROM $4
      FOR UPDATE
    `,
    [branchId, productId, unitLevelId, lotId || null]
  );

  if (!existing.rows[0]) {
    if (deltaQty < 0) {
      throw httpError(400, "Insufficient stock for requested movement");
    }
    await client.query(
      `
        INSERT INTO stock_on_hand (
          branch_id,
          product_id,
          lot_id,
          base_unit_level_id,
          quantity_on_hand,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, now())
      `,
      [branchId, productId, lotId || null, unitLevelId, deltaQty]
    );
    return;
  }

  const currentQty = Number(existing.rows[0].quantity_on_hand);
  const nextQty = currentQty + deltaQty;

  if (nextQty < 0) {
    throw httpError(400, "Insufficient stock for requested movement");
  }

  await client.query(
    `
      UPDATE stock_on_hand
      SET quantity_on_hand = $2,
          updated_at = now()
      WHERE id = $1
    `,
    [existing.rows[0].id, nextQty]
  );
}

export async function upsertPatientByPid(client, patient) {
  const pid = String(patient?.pid || "").trim();
  const fullName = String(patient?.fullName || patient?.full_name || "").trim();

  if (!pid) throw httpError(400, "patient.pid is required");
  if (!fullName) throw httpError(400, "patient.fullName is required");

  const rawSex = String(patient?.sex || "UNKNOWN").trim().toUpperCase();
  const normalizedSex =
    rawSex === "M" || rawSex === "MALE"
      ? "MALE"
      : rawSex === "F" || rawSex === "FEMALE"
      ? "FEMALE"
      : rawSex === "OTHER"
      ? "OTHER"
      : "UNKNOWN";

  const result = await client.query(
    `
      INSERT INTO patients (
        pid,
        full_name,
        birth_date,
        sex,
        card_issue_place,
        card_issued_date,
        card_expiry_date,
        address_raw_text,
        address_line1,
        district,
        province,
        postal_code,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3::date,
        COALESCE($4::sex_type, 'UNKNOWN'::sex_type),
        $5,
        $6::date,
        $7::date,
        $8,
        $9,
        $10,
        $11,
        $12,
        now()
      )
      ON CONFLICT (pid)
      DO UPDATE SET
        full_name = EXCLUDED.full_name,
        birth_date = EXCLUDED.birth_date,
        sex = EXCLUDED.sex,
        card_issue_place = EXCLUDED.card_issue_place,
        card_issued_date = EXCLUDED.card_issued_date,
        card_expiry_date = EXCLUDED.card_expiry_date,
        address_raw_text = EXCLUDED.address_raw_text,
        address_line1 = EXCLUDED.address_line1,
        district = EXCLUDED.district,
        province = EXCLUDED.province,
        postal_code = EXCLUDED.postal_code,
        updated_at = now()
      RETURNING id
    `,
    [
      pid,
      fullName,
      patient?.birthDate || patient?.birth_date || null,
      normalizedSex,
      patient?.cardIssuePlace || null,
      patient?.cardIssuedDate || null,
      patient?.cardExpiryDate || null,
      patient?.addressText || patient?.address_raw_text || null,
      patient?.addressLine1 || null,
      patient?.district || null,
      patient?.province || null,
      patient?.postalCode || null,
    ]
  );

  return result.rows[0].id;
}
