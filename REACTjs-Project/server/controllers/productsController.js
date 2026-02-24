import { query } from "../db/pool.js";
import { httpError } from "../utils/httpError.js";

async function resolveDosageFormId(dosageFormCode, dosageFormNameTh) {
  const code = String(dosageFormCode || "TABLET").trim().toUpperCase();
  if (!code) throw httpError(400, "dosageFormCode is required");

  const existing = await query(
    `
      SELECT id
      FROM dosage_forms
      WHERE code = $1
      LIMIT 1
    `,
    [code]
  );

  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await query(
    `
      INSERT INTO dosage_forms (code, name_en, name_th, dosage_form_group, is_active)
      VALUES ($1, $2, $3, 'OTHER', true)
      RETURNING id
    `,
    [code, code, dosageFormNameTh || code]
  );

  return inserted.rows[0].id;
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

export async function listProducts(req, res) {
  const search = String(req.query.search || "").trim();
  const includeInactive = parseBoolean(req.query.includeInactive, false);
  const barcode = String(req.query.barcode || "").trim();

  if (barcode) {
    const result = await query(
      `
        SELECT
          pul.barcode,
          p.product_code,
          p.trade_name,
          COALESCE(pp.price, 0) AS price,
          ut.symbol AS unit_symbol
        FROM product_unit_levels pul
        JOIN products p ON p.id = pul.product_id
        LEFT JOIN unit_types ut ON ut.id = pul.unit_type_id
        LEFT JOIN LATERAL (
          SELECT pp.price
          FROM product_prices pp
          LEFT JOIN price_tiers pt ON pt.id = pp.price_tier_id
          WHERE pp.product_id = p.id
            AND pp.unit_level_id = pul.id
            AND (pp.effective_to IS NULL OR pp.effective_to >= CURRENT_DATE)
          ORDER BY
            COALESCE(pt.is_default, false) DESC,
            pp.effective_from DESC
          LIMIT 1
        ) pp ON true
        WHERE pul.barcode = $1
          AND p.is_active = true
        LIMIT 1
      `,
      [barcode]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Product not found for barcode" });
    }

    return res.json({
      barcode: result.rows[0].barcode,
      product_code: result.rows[0].product_code,
      product_name: result.rows[0].trade_name,
      price_baht: Number(result.rows[0].price || 0),
      qty_per_unit: 1,
      unit: result.rows[0].unit_symbol || "",
    });
  }

  const pattern = `%${search}%`;
  const result = await query(
    `
      SELECT
        p.id,
        p.product_code AS "productCode",
        p.trade_name AS "tradeName",
        p.generic_name AS "genericName",
        df.code AS "dosageFormCode",
        p.note_text AS "noteText",
        p.is_active AS "isActive",
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt"
      FROM products p
      JOIN dosage_forms df ON df.id = p.dosage_form_id
      WHERE (
        $1::text = ''
        OR p.trade_name ILIKE $2
        OR COALESCE(p.generic_name, '') ILIKE $2
        OR COALESCE(p.product_code, '') ILIKE $2
      )
        AND ($3::boolean = true OR p.is_active = true)
      ORDER BY p.updated_at DESC, p.trade_name ASC
      LIMIT 500
    `,
    [search, pattern, includeInactive]
  );

  return res.json(result.rows);
}

export async function getProductsSnapshot(_req, res) {
  const result = await query(
    `
      SELECT
        pul.barcode,
        p.product_code,
        p.trade_name,
        COALESCE(pp.price, 0) AS price,
        ut.symbol AS unit_symbol
      FROM product_unit_levels pul
      JOIN products p ON p.id = pul.product_id
      LEFT JOIN unit_types ut ON ut.id = pul.unit_type_id
      LEFT JOIN LATERAL (
        SELECT pp.price
        FROM product_prices pp
        LEFT JOIN price_tiers pt ON pt.id = pp.price_tier_id
        WHERE pp.product_id = p.id
          AND pp.unit_level_id = pul.id
          AND (pp.effective_to IS NULL OR pp.effective_to >= CURRENT_DATE)
        ORDER BY
          COALESCE(pt.is_default, false) DESC,
          pp.effective_from DESC
        LIMIT 1
      ) pp ON true
      WHERE p.is_active = true
        AND pul.barcode IS NOT NULL
      ORDER BY p.trade_name ASC
      LIMIT 5000
    `
  );

  return res.json(
    result.rows.map((row) => ({
      barcode: row.barcode,
      product_code: row.product_code,
      product_name: row.trade_name,
      price_baht: Number(row.price || 0),
      qty_per_unit: 1,
      unit: row.unit_symbol || "",
    }))
  );
}

export async function getProductsVersion(_req, res) {
  const result = await query(
    `
      SELECT
        to_char(MAX(ts), 'YYYYMMDDHH24MISSMS') AS version
      FROM (
        SELECT MAX(updated_at) AS ts FROM products
        UNION ALL
        SELECT MAX(created_at) AS ts FROM product_unit_levels
        UNION ALL
        SELECT MAX(created_at) AS ts FROM product_prices
      ) q
    `
  );

  return res.json({ version: result.rows[0]?.version || "0" });
}

export async function createProduct(req, res) {
  const tradeName = String(req.body?.tradeName || req.body?.trade_name || "").trim();
  if (!tradeName) {
    throw httpError(400, "tradeName is required");
  }

  const dosageFormId = await resolveDosageFormId(
    req.body?.dosageFormCode || req.body?.dosage_form_code,
    req.body?.dosageFormNameTh || req.body?.dosage_form_name_th
  );

  const result = await query(
    `
      INSERT INTO products (
        product_code,
        trade_name,
        generic_name,
        dosage_form_id,
        note_text,
        is_active,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, true, now())
      RETURNING
        id,
        product_code AS "productCode",
        trade_name AS "tradeName",
        generic_name AS "genericName",
        note_text AS "noteText",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      req.body?.productCode || req.body?.product_code || null,
      tradeName,
      req.body?.genericName || req.body?.generic_name || null,
      dosageFormId,
      req.body?.noteText || req.body?.note_text || null,
    ]
  );

  return res.status(201).json(result.rows[0]);
}

export async function updateProduct(req, res) {
  const id = req.params.id;
  const existing = await query(
    `
      SELECT id
      FROM products
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  if (!existing.rows[0]) {
    throw httpError(404, "Product not found");
  }

  const tradeName = String(req.body?.tradeName || req.body?.trade_name || "").trim();
  if (!tradeName) {
    throw httpError(400, "tradeName is required");
  }

  const dosageFormId = await resolveDosageFormId(
    req.body?.dosageFormCode || req.body?.dosage_form_code,
    req.body?.dosageFormNameTh || req.body?.dosage_form_name_th
  );

  const result = await query(
    `
      UPDATE products
      SET
        product_code = $2,
        trade_name = $3,
        generic_name = $4,
        dosage_form_id = $5,
        note_text = $6,
        is_active = $7,
        updated_at = now()
      WHERE id = $1
      RETURNING
        id,
        product_code AS "productCode",
        trade_name AS "tradeName",
        generic_name AS "genericName",
        note_text AS "noteText",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      id,
      req.body?.productCode || req.body?.product_code || null,
      tradeName,
      req.body?.genericName || req.body?.generic_name || null,
      dosageFormId,
      req.body?.noteText || req.body?.note_text || null,
      parseBoolean(req.body?.isActive ?? req.body?.is_active, true),
    ]
  );

  return res.json(result.rows[0]);
}

export async function deleteProduct(req, res) {
  const id = req.params.id;
  const result = await query(
    `
      UPDATE products
      SET is_active = false, updated_at = now()
      WHERE id = $1
      RETURNING id
    `,
    [id]
  );

  if (!result.rows[0]) {
    throw httpError(404, "Product not found");
  }

  return res.status(204).send();
}
