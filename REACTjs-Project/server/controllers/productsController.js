import { query, withTransaction } from "../db/pool.js";
import { httpError } from "../utils/httpError.js";

const INGREDIENT_CODE_MAX_LENGTH = 80;
const LOCATION_CODE_MAX_LENGTH = 30;
const UNIT_LEVEL_DEFAULT_CODE = "SELLABLE";

function hasOwnField(objectValue, key) {
  return Object.prototype.hasOwnProperty.call(objectValue || {}, key);
}

function toCleanText(value) {
  return String(value ?? "").trim();
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveNumber(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw httpError(400, `${fieldName} must be a positive number`);
  }
  return numeric;
}

function parseOptionalNonNegativeNumber(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw httpError(400, `${fieldName} must be a non-negative number`);
  }
  return numeric;
}

function buildIngredientCodeBase(nameEn) {
  const normalized = toCleanText(nameEn)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = normalized || "INGREDIENT";
  return base.slice(0, INGREDIENT_CODE_MAX_LENGTH - 4);
}

function buildLocationCodeBase(name) {
  const normalized = toCleanText(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = normalized || "MFR";
  const maxBaseLength = LOCATION_CODE_MAX_LENGTH - 4;
  return base.slice(0, maxBaseLength);
}

function composeGenericName(ingredients) {
  const names = ingredients
    .map((ingredient) => toCleanText(ingredient.nameEn))
    .filter(Boolean);
  return names.join(" + ");
}

function normalizeIngredientsInput(rawIngredients) {
  if (!Array.isArray(rawIngredients)) {
    throw httpError(400, "ingredients must be an array");
  }

  return rawIngredients
    .map((row, index) => {
      const source = row && typeof row === "object" ? row : {};
      const activeIngredientCode = toCleanText(
        source.activeIngredientCode ?? source.ingredientCode ?? source.code
      ).toUpperCase();
      const nameEn = toCleanText(source.nameEn ?? source.name ?? source.activeIngredientName);
      const nameTh = toCleanText(source.nameTh ?? source.activeIngredientNameTh);
      const strengthNumeratorRaw =
        source.strengthNumerator ?? source.numerator ?? source.strength_value ?? "";
      const numeratorUnitCode = toCleanText(
        source.numeratorUnitCode ?? source.numeratorUnit ?? source.strengthUnitCode
      ).toUpperCase();
      const strengthDenominatorRaw =
        source.strengthDenominator ?? source.denominator ?? source.denominatorValue ?? "";
      const denominatorUnitCode = toCleanText(
        source.denominatorUnitCode ?? source.denominatorUnit
      ).toUpperCase();
      const rowNumber = index + 1;

      const isBlankRow =
        !activeIngredientCode &&
        !nameEn &&
        !nameTh &&
        String(strengthNumeratorRaw ?? "").trim() === "" &&
        !numeratorUnitCode &&
        String(strengthDenominatorRaw ?? "").trim() === "" &&
        !denominatorUnitCode;
      if (isBlankRow) return null;

      if (!nameEn && !activeIngredientCode) {
        throw httpError(400, `ingredients[${rowNumber}] requires nameEn or activeIngredientCode`);
      }

      const strengthNumerator = parsePositiveNumber(
        strengthNumeratorRaw,
        `ingredients[${rowNumber}].strengthNumerator`
      );

      if (!numeratorUnitCode) {
        throw httpError(400, `ingredients[${rowNumber}].numeratorUnitCode is required`);
      }

      const hasDenominatorValue = String(strengthDenominatorRaw ?? "").trim() !== "";
      const hasDenominatorUnit = Boolean(denominatorUnitCode);
      if (hasDenominatorValue !== hasDenominatorUnit) {
        throw httpError(
          400,
          `ingredients[${rowNumber}] denominator requires both strengthDenominator and denominatorUnitCode`
        );
      }

      const strengthDenominator = hasDenominatorValue
        ? parsePositiveNumber(
            strengthDenominatorRaw,
            `ingredients[${rowNumber}].strengthDenominator`
          )
        : null;

      return {
        activeIngredientCode: activeIngredientCode || null,
        nameEn: nameEn || activeIngredientCode,
        nameTh: nameTh || null,
        strengthNumerator,
        numeratorUnitCode,
        strengthDenominator,
        denominatorUnitCode: hasDenominatorUnit ? denominatorUnitCode : null,
      };
    })
    .filter(Boolean);
}

function normalizeReportGroupCodesInput(body) {
  const source = body && typeof body === "object" ? body : {};
  const hasArray = hasOwnField(source, "reportGroupCodes");
  const hasSingle =
    hasOwnField(source, "reportGroupCode") ||
    hasOwnField(source, "report_group_code") ||
    hasOwnField(source, "reportType");

  let rawCodes = [];
  if (hasArray && Array.isArray(source.reportGroupCodes)) {
    rawCodes = source.reportGroupCodes;
  } else if (hasSingle) {
    rawCodes = [source.reportGroupCode ?? source.report_group_code ?? source.reportType];
  }

  const codes = [...new Set(rawCodes.map((code) => toCleanText(code).toUpperCase()).filter(Boolean))];
  return {
    hasReportGroupField: hasArray || hasSingle,
    reportGroupCodes: codes,
  };
}

async function resolveDosageFormId(db, dosageFormCode, dosageFormNameTh) {
  const code = String(dosageFormCode || "TABLET").trim().toUpperCase();
  if (!code) throw httpError(400, "dosageFormCode is required");

  const existing = await db.query(
    `
      SELECT id
      FROM dosage_forms
      WHERE code = $1
      LIMIT 1
    `,
    [code]
  );

  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await db.query(
    `
      INSERT INTO dosage_forms (code, name_en, name_th, dosage_form_group, is_active)
      VALUES ($1, $2, $3, 'OTHER', true)
      RETURNING id
    `,
    [code, code, dosageFormNameTh || code]
  );

  return inserted.rows[0].id;
}

async function resolveUnitTypeId(db, unitCode) {
  const code = String(unitCode || "").trim().toUpperCase();
  if (!code) throw httpError(400, "unit code is required");

  const result = await db.query(
    `
      SELECT id
      FROM unit_types
      WHERE code = $1
      LIMIT 1
    `,
    [code]
  );

  if (!result.rows[0]) {
    throw httpError(400, `Unknown unit type code: ${code}`);
  }

  return result.rows[0].id;
}

async function generateUniqueIngredientCode(db, nameEn) {
  const baseCode = buildIngredientCodeBase(nameEn);
  let candidateCode = baseCode;
  let suffix = 2;

  while (true) {
    const exists = await db.query(
      `
        SELECT 1
        FROM active_ingredients
        WHERE code = $1
        LIMIT 1
      `,
      [candidateCode]
    );

    if (!exists.rows[0]) return candidateCode;

    const suffixText = `_${suffix}`;
    const prefixLength = INGREDIENT_CODE_MAX_LENGTH - suffixText.length;
    candidateCode = `${baseCode.slice(0, prefixLength)}${suffixText}`;
    suffix += 1;
  }
}

async function generateUniqueLocationCode(db, locationName) {
  const baseCode = buildLocationCodeBase(locationName);
  let candidateCode = `MFR_${baseCode}`;
  let suffix = 2;

  while (true) {
    const exists = await db.query(
      `
        SELECT 1
        FROM locations
        WHERE code = $1
        LIMIT 1
      `,
      [candidateCode]
    );

    if (!exists.rows[0]) return candidateCode;

    const suffixText = `_${suffix}`;
    const basePrefixLength = LOCATION_CODE_MAX_LENGTH - 4 - suffixText.length;
    candidateCode = `MFR_${baseCode.slice(0, basePrefixLength)}${suffixText}`;
    suffix += 1;
  }
}

async function resolveManufacturerLocationId(db, manufacturerName) {
  const name = toCleanText(manufacturerName);
  if (!name) return null;

  const existing = await db.query(
    `
      SELECT id
      FROM locations
      WHERE lower(name) = lower($1)
        AND location_type IN ('MANUFACTURER', 'VENDOR', 'WHOLESALER')
      LIMIT 1
    `,
    [name]
  );

  if (existing.rows[0]) return existing.rows[0].id;

  const code = await generateUniqueLocationCode(db, name);
  const inserted = await db.query(
    `
      INSERT INTO locations (code, name, location_type, is_active)
      VALUES ($1, $2, 'MANUFACTURER', true)
      RETURNING id
    `,
    [code, name]
  );

  return inserted.rows[0].id;
}

async function resolveDefaultPriceTierId(db) {
  const existingDefault = await db.query(
    `
      SELECT id
      FROM price_tiers
      WHERE is_default = true
        AND is_active = true
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
    `
  );

  if (existingDefault.rows[0]) return existingDefault.rows[0].id;

  const upserted = await db.query(
    `
      INSERT INTO price_tiers (code, name_en, name_th, is_default, priority, is_active)
      VALUES ('RETAIL', 'Retail', 'ราคาขายปลีก', true, 10, true)
      ON CONFLICT (code) DO UPDATE
      SET
        is_default = true,
        is_active = true
      RETURNING id
    `
  );

  return upserted.rows[0].id;
}

async function resolvePrimaryUnitLevel(db, productId) {
  const result = await db.query(
    `
      SELECT
        pul.id,
        pul.display_name,
        pul.barcode,
        pul.unit_type_id,
        ut.code AS unit_type_code
      FROM product_unit_levels pul
      LEFT JOIN unit_types ut ON ut.id = pul.unit_type_id
      WHERE pul.product_id = $1
      ORDER BY pul.is_sellable DESC, pul.is_base DESC, pul.sort_order ASC, pul.created_at ASC
      LIMIT 1
    `,
    [productId]
  );

  return result.rows[0] || null;
}

async function upsertPrimaryUnitLevelAndPrice(db, productId, options) {
  const shouldUpsertUnit = options.shouldUpsertUnit;
  if (!shouldUpsertUnit && options.price === null) return;

  let unitLevel = await resolvePrimaryUnitLevel(db, productId);

  if (shouldUpsertUnit) {
    const unitTypeCode = options.unitTypeCode || unitLevel?.unit_type_code || "TABLET";
    const unitTypeId = await resolveUnitTypeId(db, unitTypeCode);
    const nextDisplayName =
      options.packageSize || unitLevel?.display_name || "หน่วยขายมาตรฐาน";
    const nextBarcode =
      options.barcode !== undefined
        ? options.barcode || null
        : unitLevel?.barcode || null;

    if (unitLevel) {
      const updated = await db.query(
        `
          UPDATE product_unit_levels
          SET
            display_name = $2,
            unit_type_id = $3,
            barcode = $4,
            is_sellable = true
          WHERE id = $1
          RETURNING
            id,
            display_name,
            barcode,
            unit_type_id
        `,
        [unitLevel.id, nextDisplayName, unitTypeId, nextBarcode]
      );
      unitLevel = {
        ...unitLevel,
        id: updated.rows[0].id,
        display_name: updated.rows[0].display_name,
        barcode: updated.rows[0].barcode,
        unit_type_id: updated.rows[0].unit_type_id,
        unit_type_code: unitTypeCode,
      };
    } else {
      const inserted = await db.query(
        `
          INSERT INTO product_unit_levels (
            product_id,
            code,
            display_name,
            unit_type_id,
            is_base,
            is_sellable,
            sort_order,
            barcode
          )
          VALUES ($1, $2, $3, $4, true, true, 1, $5)
          RETURNING id
        `,
        [productId, UNIT_LEVEL_DEFAULT_CODE, nextDisplayName, unitTypeId, nextBarcode]
      );
      unitLevel = {
        id: inserted.rows[0].id,
        display_name: nextDisplayName,
        barcode: nextBarcode,
        unit_type_id: unitTypeId,
        unit_type_code: unitTypeCode,
      };
    }
  }

  if (options.price !== null) {
    if (!unitLevel) {
      throw httpError(400, "unit level is required before saving price");
    }

    const priceTierId = await resolveDefaultPriceTierId(db);
    await db.query(
      `
        INSERT INTO product_prices (
          product_id,
          unit_level_id,
          price_tier_id,
          price,
          currency_code,
          effective_from,
          effective_to
        )
        VALUES ($1, $2, $3, $4, 'THB', CURRENT_DATE, NULL)
        ON CONFLICT (product_id, unit_level_id, price_tier_id, effective_from)
        DO UPDATE
        SET
          price = EXCLUDED.price,
          effective_to = NULL
      `,
      [productId, unitLevel.id, priceTierId, options.price]
    );
  }
}

async function resolveActiveIngredientId(db, ingredient) {
  if (ingredient.activeIngredientCode) {
    const existing = await db.query(
      `
        SELECT id
        FROM active_ingredients
        WHERE code = $1
        LIMIT 1
      `,
      [ingredient.activeIngredientCode]
    );

    if (existing.rows[0]) return existing.rows[0].id;

    const inserted = await db.query(
      `
        INSERT INTO active_ingredients (code, name_en, name_th, is_active)
        VALUES ($1, $2, $3, true)
        RETURNING id
      `,
      [ingredient.activeIngredientCode, ingredient.nameEn, ingredient.nameTh]
    );

    return inserted.rows[0].id;
  }

  const byName = await db.query(
    `
      SELECT id
      FROM active_ingredients
      WHERE lower(name_en) = lower($1)
      LIMIT 1
    `,
    [ingredient.nameEn]
  );

  if (byName.rows[0]) return byName.rows[0].id;

  const generatedCode = await generateUniqueIngredientCode(db, ingredient.nameEn);
  const inserted = await db.query(
    `
      INSERT INTO active_ingredients (code, name_en, name_th, is_active)
      VALUES ($1, $2, $3, true)
      RETURNING id
    `,
    [generatedCode, ingredient.nameEn, ingredient.nameTh]
  );

  return inserted.rows[0].id;
}

async function syncProductIngredients(db, productId, ingredients) {
  await db.query(
    `
      DELETE FROM product_ingredients
      WHERE product_id = $1
    `,
    [productId]
  );

  if (!ingredients.length) return;

  const unitTypeIdCache = new Map();

  async function resolveUnitTypeIdCached(unitCode) {
    const key = String(unitCode || "").trim().toUpperCase();
    if (unitTypeIdCache.has(key)) {
      return unitTypeIdCache.get(key);
    }
    const id = await resolveUnitTypeId(db, key);
    unitTypeIdCache.set(key, id);
    return id;
  }

  for (let index = 0; index < ingredients.length; index += 1) {
    const ingredient = ingredients[index];
    const activeIngredientId = await resolveActiveIngredientId(db, ingredient);
    const numeratorUnitId = await resolveUnitTypeIdCached(ingredient.numeratorUnitCode);
    const denominatorUnitId = ingredient.denominatorUnitCode
      ? await resolveUnitTypeIdCached(ingredient.denominatorUnitCode)
      : null;

    await db.query(
      `
        INSERT INTO product_ingredients (
          product_id,
          active_ingredient_id,
          strength_numerator,
          numerator_unit_id,
          strength_denominator,
          denominator_unit_id,
          sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        productId,
        activeIngredientId,
        ingredient.strengthNumerator,
        numeratorUnitId,
        ingredient.strengthDenominator,
        denominatorUnitId,
        index + 1,
      ]
    );
  }
}

async function resolveReportGroupsByCodes(db, reportGroupCodes) {
  if (!reportGroupCodes.length) return [];

  const result = await db.query(
    `
      SELECT id, code
      FROM report_groups
      WHERE code = ANY($1::text[])
    `,
    [reportGroupCodes]
  );

  const foundByCode = new Map(result.rows.map((row) => [row.code, row.id]));
  const missingCodes = reportGroupCodes.filter((code) => !foundByCode.has(code));
  if (missingCodes.length) {
    throw httpError(400, `Unknown report group code(s): ${missingCodes.join(", ")}`);
  }

  return reportGroupCodes.map((code) => ({ code, id: foundByCode.get(code) }));
}

async function syncProductReportGroups(db, productId, reportGroupCodes) {
  const resolvedGroups = await resolveReportGroupsByCodes(db, reportGroupCodes);
  const targetCodes = new Set(resolvedGroups.map((group) => group.code));

  const existingActive = await db.query(
    `
      SELECT
        prg.id,
        prg.report_group_id,
        rg.code
      FROM product_report_groups prg
      JOIN report_groups rg ON rg.id = prg.report_group_id
      WHERE prg.product_id = $1
        AND prg.effective_from <= CURRENT_DATE
        AND (prg.effective_to IS NULL OR prg.effective_to > CURRENT_DATE)
    `,
    [productId]
  );

  const existingByCode = new Map(existingActive.rows.map((row) => [row.code, row]));

  for (const row of existingActive.rows) {
    if (!targetCodes.has(row.code)) {
      await db.query(
        `
          UPDATE product_report_groups
          SET effective_to = CURRENT_DATE
          WHERE id = $1
            AND (effective_to IS NULL OR effective_to > CURRENT_DATE)
        `,
        [row.id]
      );
    }
  }

  for (const group of resolvedGroups) {
    if (existingByCode.has(group.code)) continue;
    await db.query(
      `
        INSERT INTO product_report_groups (
          product_id,
          report_group_id,
          effective_from,
          effective_to
        )
        VALUES ($1, $2, CURRENT_DATE, NULL)
        ON CONFLICT (product_id, report_group_id, effective_from)
        DO UPDATE
        SET effective_to = NULL
      `,
      [productId, group.id]
    );
  }
}

function mapProductRow(row) {
  return {
    ...row,
    ingredients: Array.isArray(row.ingredients) ? row.ingredients : [],
    reportGroupCodes: Array.isArray(row.reportGroupCodes) ? row.reportGroupCodes : [],
    reportGroupNames: Array.isArray(row.reportGroupNames) ? row.reportGroupNames : [],
    price: row.price === null || row.price === undefined ? null : Number(row.price),
  };
}

async function getProductById(productId) {
  const result = await query(
    `
      SELECT
        p.id,
        p.product_code AS "productCode",
        p.trade_name AS "tradeName",
        COALESCE(ing.generic_composition, p.generic_name) AS "genericName",
        COALESCE(ing.ingredients, '[]'::json) AS ingredients,
        pu.barcode AS barcode,
        pu.package_size AS "packageSize",
        pu.unit_type_code AS "unitTypeCode",
        pu.unit_symbol AS "unitSymbol",
        pu.price AS price,
        COALESCE(pr.report_group_codes, ARRAY[]::text[]) AS "reportGroupCodes",
        COALESCE(pr.report_group_names, ARRAY[]::text[]) AS "reportGroupNames",
        mloc.name AS "manufacturerName",
        df.code AS "dosageFormCode",
        p.note_text AS "noteText",
        p.is_active AS "isActive",
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt"
      FROM products p
      JOIN dosage_forms df ON df.id = p.dosage_form_id
      LEFT JOIN locations mloc ON mloc.id = p.manufacturer_location_id
      LEFT JOIN LATERAL (
        SELECT
          string_agg(ai.name_en, ' + ' ORDER BY pi.sort_order) AS generic_composition,
          json_agg(
            json_build_object(
              'ingredientId', ai.id,
              'activeIngredientCode', ai.code,
              'nameEn', ai.name_en,
              'nameTh', ai.name_th,
              'strengthNumerator', pi.strength_numerator,
              'numeratorUnitCode', nu.code,
              'numeratorUnitSymbol', nu.symbol,
              'strengthDenominator', pi.strength_denominator,
              'denominatorUnitCode', du.code,
              'denominatorUnitSymbol', du.symbol,
              'sortOrder', pi.sort_order
            )
            ORDER BY pi.sort_order
          ) AS ingredients
        FROM product_ingredients pi
        JOIN active_ingredients ai ON ai.id = pi.active_ingredient_id
        JOIN unit_types nu ON nu.id = pi.numerator_unit_id
        LEFT JOIN unit_types du ON du.id = pi.denominator_unit_id
        WHERE pi.product_id = p.id
      ) ing ON true
      LEFT JOIN LATERAL (
        SELECT
          pul.barcode,
          pul.display_name AS package_size,
          ut.code AS unit_type_code,
          ut.symbol AS unit_symbol,
          (
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
          ) AS price
        FROM product_unit_levels pul
        LEFT JOIN unit_types ut ON ut.id = pul.unit_type_id
        WHERE pul.product_id = p.id
        ORDER BY pul.is_sellable DESC, pul.is_base DESC, pul.sort_order ASC, pul.created_at ASC
        LIMIT 1
      ) pu ON true
      LEFT JOIN LATERAL (
        SELECT
          array_agg(rg.code ORDER BY rg.code) AS report_group_codes,
          array_agg(rg.thai_name ORDER BY rg.code) AS report_group_names
        FROM product_report_groups prg
        JOIN report_groups rg ON rg.id = prg.report_group_id
        WHERE prg.product_id = p.id
          AND prg.effective_from <= CURRENT_DATE
          AND (prg.effective_to IS NULL OR prg.effective_to > CURRENT_DATE)
      ) pr ON true
      WHERE p.id = $1
      LIMIT 1
    `,
    [productId]
  );

  if (!result.rows[0]) return null;
  return mapProductRow(result.rows[0]);
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
        COALESCE(ing.generic_composition, p.generic_name) AS "genericName",
        COALESCE(ing.ingredients, '[]'::json) AS ingredients,
        pu.barcode AS barcode,
        pu.package_size AS "packageSize",
        pu.unit_type_code AS "unitTypeCode",
        pu.unit_symbol AS "unitSymbol",
        pu.price AS price,
        COALESCE(pr.report_group_codes, ARRAY[]::text[]) AS "reportGroupCodes",
        COALESCE(pr.report_group_names, ARRAY[]::text[]) AS "reportGroupNames",
        mloc.name AS "manufacturerName",
        df.code AS "dosageFormCode",
        p.note_text AS "noteText",
        p.is_active AS "isActive",
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt"
      FROM products p
      JOIN dosage_forms df ON df.id = p.dosage_form_id
      LEFT JOIN locations mloc ON mloc.id = p.manufacturer_location_id
      LEFT JOIN LATERAL (
        SELECT
          string_agg(ai.name_en, ' + ' ORDER BY pi.sort_order) AS generic_composition,
          json_agg(
            json_build_object(
              'ingredientId', ai.id,
              'activeIngredientCode', ai.code,
              'nameEn', ai.name_en,
              'nameTh', ai.name_th,
              'strengthNumerator', pi.strength_numerator,
              'numeratorUnitCode', nu.code,
              'numeratorUnitSymbol', nu.symbol,
              'strengthDenominator', pi.strength_denominator,
              'denominatorUnitCode', du.code,
              'denominatorUnitSymbol', du.symbol,
              'sortOrder', pi.sort_order
            )
            ORDER BY pi.sort_order
          ) AS ingredients
        FROM product_ingredients pi
        JOIN active_ingredients ai ON ai.id = pi.active_ingredient_id
        JOIN unit_types nu ON nu.id = pi.numerator_unit_id
        LEFT JOIN unit_types du ON du.id = pi.denominator_unit_id
        WHERE pi.product_id = p.id
      ) ing ON true
      LEFT JOIN LATERAL (
        SELECT
          pul.barcode,
          pul.display_name AS package_size,
          ut.code AS unit_type_code,
          ut.symbol AS unit_symbol,
          (
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
          ) AS price
        FROM product_unit_levels pul
        LEFT JOIN unit_types ut ON ut.id = pul.unit_type_id
        WHERE pul.product_id = p.id
        ORDER BY pul.is_sellable DESC, pul.is_base DESC, pul.sort_order ASC, pul.created_at ASC
        LIMIT 1
      ) pu ON true
      LEFT JOIN LATERAL (
        SELECT
          array_agg(rg.code ORDER BY rg.code) AS report_group_codes,
          array_agg(rg.thai_name ORDER BY rg.code) AS report_group_names
        FROM product_report_groups prg
        JOIN report_groups rg ON rg.id = prg.report_group_id
        WHERE prg.product_id = p.id
          AND prg.effective_from <= CURRENT_DATE
          AND (prg.effective_to IS NULL OR prg.effective_to > CURRENT_DATE)
      ) pr ON true
      WHERE (
        $1::text = ''
        OR p.trade_name ILIKE $2
        OR COALESCE(p.generic_name, '') ILIKE $2
        OR COALESCE(p.product_code, '') ILIKE $2
        OR COALESCE(pu.barcode, '') ILIKE $2
        OR COALESCE(pu.package_size, '') ILIKE $2
        OR COALESCE(mloc.name, '') ILIKE $2
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(pr.report_group_codes, ARRAY[]::text[])) AS rg_code
          WHERE rg_code ILIKE $2
        )
        OR EXISTS (
          SELECT 1
          FROM product_ingredients spi
          JOIN active_ingredients sai ON sai.id = spi.active_ingredient_id
          WHERE spi.product_id = p.id
            AND (
              sai.name_en ILIKE $2
              OR COALESCE(sai.name_th, '') ILIKE $2
              OR sai.code ILIKE $2
            )
        )
      )
        AND ($3::boolean = true OR p.is_active = true)
      ORDER BY p.updated_at DESC, p.trade_name ASC
      LIMIT 500
    `,
    [search, pattern, includeInactive]
  );

  return res.json(result.rows.map(mapProductRow));
}

export async function getReportGroups(_req, res) {
  const result = await query(
    `
      SELECT
        code,
        thai_name AS "thaiName",
        description
      FROM report_groups
      WHERE is_active = true
      ORDER BY code ASC
    `
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
        UNION ALL
        SELECT MAX(created_at) AS ts FROM product_ingredients
        UNION ALL
        SELECT MAX(created_at) AS ts FROM product_report_groups
      ) q
    `
  );

  return res.json({ version: result.rows[0]?.version || "0" });
}

export async function createProduct(req, res) {
  const body = req.body || {};
  const tradeName = toCleanText(body.tradeName || body.trade_name);
  if (!tradeName) {
    throw httpError(400, "tradeName is required");
  }

  const hasIngredientsField = hasOwnField(body, "ingredients");
  const ingredients = hasIngredientsField ? normalizeIngredientsInput(body.ingredients) : [];
  const { reportGroupCodes } = normalizeReportGroupCodesInput(body);
  const genericNameInput = toCleanText(body.genericName || body.generic_name);
  const genericName = ingredients.length ? composeGenericName(ingredients) : genericNameInput || null;
  const barcode = toCleanText(body.barcode);
  const manufacturerName = toCleanText(body.manufacturerName || body.importerName);
  const packageSize = toCleanText(body.packageSize || body.packageLabel || body.package_notes);
  const unitTypeCode = toCleanText(body.unitTypeCode || body.unit_code).toUpperCase();
  const price = parseOptionalNonNegativeNumber(body.price, "price");
  const shouldUpsertUnit =
    hasOwnField(body, "barcode") ||
    hasOwnField(body, "packageSize") ||
    hasOwnField(body, "packageLabel") ||
    hasOwnField(body, "package_notes") ||
    hasOwnField(body, "unitTypeCode") ||
    hasOwnField(body, "unit_code") ||
    price !== null;

  const productId = await withTransaction(async (client) => {
    const dosageFormId = await resolveDosageFormId(
      client,
      body.dosageFormCode || body.dosage_form_code,
      body.dosageFormNameTh || body.dosage_form_name_th
    );
    const manufacturerLocationId = manufacturerName
      ? await resolveManufacturerLocationId(client, manufacturerName)
      : null;

    const inserted = await client.query(
      `
        INSERT INTO products (
          product_code,
          trade_name,
          generic_name,
          dosage_form_id,
          manufacturer_location_id,
          note_text,
          is_active,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, true, now())
        RETURNING id
      `,
      [
        toCleanText(body.productCode || body.product_code) || null,
        tradeName,
        genericName,
        dosageFormId,
        manufacturerLocationId,
        toCleanText(body.noteText || body.note_text) || null,
      ]
    );

    const createdProductId = inserted.rows[0].id;
    if (hasIngredientsField) {
      await syncProductIngredients(client, createdProductId, ingredients);
    }
    if (reportGroupCodes.length) {
      await syncProductReportGroups(client, createdProductId, reportGroupCodes);
    }
    await upsertPrimaryUnitLevelAndPrice(client, createdProductId, {
      shouldUpsertUnit,
      barcode,
      packageSize,
      unitTypeCode,
      price,
    });

    return createdProductId;
  });

  const created = await getProductById(productId);
  if (!created) {
    throw httpError(500, "Unable to load created product");
  }

  return res.status(201).json(created);
}

export async function updateProduct(req, res) {
  const id = req.params.id;
  const existing = await query(
    `
      SELECT
        id,
        product_code,
        generic_name,
        dosage_form_id,
        manufacturer_location_id,
        note_text,
        is_active
      FROM products
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  if (!existing.rows[0]) {
    throw httpError(404, "Product not found");
  }

  const body = req.body || {};
  const tradeName = toCleanText(body.tradeName || body.trade_name);
  if (!tradeName) {
    throw httpError(400, "tradeName is required");
  }

  const hasIngredientsField = hasOwnField(body, "ingredients");
  const ingredients = hasIngredientsField ? normalizeIngredientsInput(body.ingredients) : [];
  const { hasReportGroupField, reportGroupCodes } = normalizeReportGroupCodesInput(body);
  const hasGenericNameField = hasOwnField(body, "genericName") || hasOwnField(body, "generic_name");
  const genericNameInput = toCleanText(body.genericName || body.generic_name);
  const hasIsActiveField = hasOwnField(body, "isActive") || hasOwnField(body, "is_active");
  const hasDosageFormField =
    hasOwnField(body, "dosageFormCode") || hasOwnField(body, "dosage_form_code");
  const hasProductCodeField = hasOwnField(body, "productCode") || hasOwnField(body, "product_code");
  const hasNoteField = hasOwnField(body, "noteText") || hasOwnField(body, "note_text");
  const hasManufacturerField =
    hasOwnField(body, "manufacturerName") || hasOwnField(body, "importerName");
  const hasBarcodeField = hasOwnField(body, "barcode");
  const hasPackageSizeField =
    hasOwnField(body, "packageSize") ||
    hasOwnField(body, "packageLabel") ||
    hasOwnField(body, "package_notes");
  const hasUnitTypeCodeField = hasOwnField(body, "unitTypeCode") || hasOwnField(body, "unit_code");
  const hasPriceField = hasOwnField(body, "price");
  const barcode = toCleanText(body.barcode);
  const packageSize = toCleanText(body.packageSize || body.packageLabel || body.package_notes);
  const unitTypeCode = toCleanText(body.unitTypeCode || body.unit_code).toUpperCase();
  const manufacturerName = toCleanText(body.manufacturerName || body.importerName);
  const price = hasPriceField ? parseOptionalNonNegativeNumber(body.price, "price") : null;
  const shouldUpsertUnit =
    hasBarcodeField || hasPackageSizeField || hasUnitTypeCodeField || hasPriceField;

  const current = existing.rows[0];
  let genericName = current.generic_name;
  if (hasIngredientsField) {
    if (ingredients.length) {
      genericName = composeGenericName(ingredients);
    } else if (hasGenericNameField) {
      genericName = genericNameInput || null;
    }
  } else if (hasGenericNameField) {
    genericName = genericNameInput || null;
  }

  const nextIsActive = hasIsActiveField
    ? parseBoolean(body.isActive ?? body.is_active, current.is_active)
    : current.is_active;

  const nextProductCode = hasProductCodeField
    ? toCleanText(body.productCode || body.product_code) || null
    : current.product_code;

  const nextNoteText = hasNoteField
    ? toCleanText(body.noteText || body.note_text) || null
    : current.note_text;
  await withTransaction(async (client) => {
    const dosageFormId = hasDosageFormField
      ? await resolveDosageFormId(
          client,
          body.dosageFormCode || body.dosage_form_code,
          body.dosageFormNameTh || body.dosage_form_name_th
        )
      : current.dosage_form_id;
    const nextManufacturerLocationId = hasManufacturerField
      ? manufacturerName
        ? await resolveManufacturerLocationId(client, manufacturerName)
        : null
      : current.manufacturer_location_id;

    await client.query(
      `
        UPDATE products
        SET
          product_code = $2,
          trade_name = $3,
          generic_name = $4,
          dosage_form_id = $5,
          manufacturer_location_id = $6,
          note_text = $7,
          is_active = $8,
          updated_at = now()
        WHERE id = $1
      `,
      [
        id,
        nextProductCode,
        tradeName,
        genericName,
        dosageFormId,
        nextManufacturerLocationId,
        nextNoteText,
        nextIsActive,
      ]
    );

    if (hasIngredientsField) {
      await syncProductIngredients(client, id, ingredients);
    }
    if (hasReportGroupField) {
      await syncProductReportGroups(client, id, reportGroupCodes);
    }
    if (shouldUpsertUnit) {
      await upsertPrimaryUnitLevelAndPrice(client, id, {
        shouldUpsertUnit,
        barcode: hasBarcodeField ? barcode : undefined,
        packageSize: hasPackageSizeField ? packageSize : "",
        unitTypeCode: hasUnitTypeCodeField ? unitTypeCode : "",
        price,
      });
    }
  });

  const updated = await getProductById(id);
  if (!updated) {
    throw httpError(500, "Unable to load updated product");
  }

  return res.json(updated);
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
