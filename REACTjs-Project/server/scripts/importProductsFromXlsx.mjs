#!/usr/bin/env node
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const { createProduct, updateProduct } = await import("../controllers/productsController.js");
const { pool, query } = await import("../db/pool.js");

function toText(value) {
  return String(value ?? "").trim();
}

function toNullableText(value) {
  const text = toText(value);
  return text || null;
}

function toNullableNumber(value) {
  const text = toText(value).replace(/,/g, "");
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeCode(value) {
  return toText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeDosageFormCode(rawValue) {
  const compact = toText(rawValue)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  const known = {
    TABLET: "TABLET",
    CAPSULE: "CAPSULE",
    SOLUTION: "ORAL_SOLUTION",
    ORALSOLUTION: "ORAL_SOLUTION",
    INHALER: "INHALER",
    OINTMENT: "OINTMENT",
    SOFTGEL: "SOFT_GEL",
  };

  if (known[compact]) return known[compact];
  return normalizeCode(rawValue) || "TABLET";
}

function parseUnitTypeCodeFromPackaging(rawPackaging) {
  const text = toText(rawPackaging);
  const match = text.match(/\(([^()]+)\)\s*$/);
  if (!match) return "";
  return normalizeCode(match[1]);
}

function parseStrengthParts(rawStrength, rawUnit) {
  const strengthNumerator = toNullableNumber(rawStrength);
  if (strengthNumerator === null || strengthNumerator <= 0) {
    throw new Error(`Invalid strength value: "${rawStrength}"`);
  }

  const unitText = toText(rawUnit).toUpperCase().replace(/\s+/g, "");
  if (!unitText) {
    throw new Error("Missing strength unit");
  }

  const ratioMatch = unitText.match(/^([A-Z0-9]+)\/([0-9]*\.?[0-9]+)([A-Z0-9]+)$/);
  if (ratioMatch) {
    const numeratorUnitCode = normalizeCode(ratioMatch[1]);
    const strengthDenominator = Number(ratioMatch[2]);
    const denominatorUnitCode = normalizeCode(ratioMatch[3]);
    if (!numeratorUnitCode || !denominatorUnitCode || !Number.isFinite(strengthDenominator)) {
      throw new Error(`Invalid ratio unit format: "${rawUnit}"`);
    }
    return {
      strengthNumerator,
      numeratorUnitCode,
      strengthDenominator,
      denominatorUnitCode,
    };
  }

  return {
    strengthNumerator,
    numeratorUnitCode: normalizeCode(unitText),
    strengthDenominator: null,
    denominatorUnitCode: null,
  };
}

function parseXlsxRowsWithPython(filePath) {
  const pyScript = `
import json
import openpyxl
import sys

path = sys.argv[1]
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]

rows = []
for row in ws.iter_rows(min_row=2, values_only=True):
    values = list(row[:12])
    while len(values) < 12:
        values.append(None)
    if not any(str(v).strip() if v is not None else "" for v in values):
        continue
    rows.append(values)

print(json.dumps(rows, ensure_ascii=False))
`;

  const proc = spawnSync("python", ["-", filePath], {
    input: pyScript,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  if (proc.status !== 0) {
    throw new Error(proc.stderr || "Failed to parse xlsx with python");
  }

  return JSON.parse(proc.stdout);
}

function toProductKey(row) {
  const productCode = toText(row[11]);
  const barcode = toText(row[10]);
  const tradeName = toText(row[0]);
  return productCode || barcode || tradeName;
}

function buildProductPayloads(rows) {
  const groups = new Map();

  rows.forEach((row, rowIndex) => {
    const key = toProductKey(row);
    if (!key) return;

    const tradeName = toText(row[0]);
    const kyType = toText(row[1]);
    const dosageForm = toText(row[2]);
    const manufacturer = toText(row[3]);
    const packagingAll = toText(row[4]);
    const ingredientName = toText(row[5]);
    const ingredientStrength = row[6];
    const ingredientUnit = row[7];
    const packagingDetail = toText(row[8]);
    const price = toNullableNumber(row[9]);
    const barcode = toText(row[10]);
    const productCode = toText(row[11]);

    if (!groups.has(key)) {
      groups.set(key, {
        sourceRows: [],
        tradeName,
        kyType,
        dosageForm,
        manufacturer,
        packagingAll,
        packagingDetail,
        price,
        barcode,
        productCode,
        ingredients: [],
      });
    }

    const current = groups.get(key);
    current.sourceRows.push(rowIndex + 2);
    if (!current.tradeName && tradeName) current.tradeName = tradeName;
    if (!current.kyType && kyType) current.kyType = kyType;
    if (!current.dosageForm && dosageForm) current.dosageForm = dosageForm;
    if (!current.manufacturer && manufacturer) current.manufacturer = manufacturer;
    if (!current.packagingAll && packagingAll) current.packagingAll = packagingAll;
    if (!current.packagingDetail && packagingDetail) current.packagingDetail = packagingDetail;
    if (current.price === null && price !== null) current.price = price;
    if (!current.barcode && barcode) current.barcode = barcode;
    if (!current.productCode && productCode) current.productCode = productCode;

    if (!ingredientName && !toText(ingredientStrength) && !toText(ingredientUnit)) {
      return;
    }

    if (!ingredientName) {
      throw new Error(`Row ${rowIndex + 2}: ingredient name is required`);
    }

    const strengthParts = parseStrengthParts(ingredientStrength, ingredientUnit);
    const ingredient = {
      activeIngredientCode: null,
      nameEn: ingredientName,
      nameTh: null,
      strengthNumerator: strengthParts.strengthNumerator,
      numeratorUnitCode: strengthParts.numeratorUnitCode,
      strengthDenominator: strengthParts.strengthDenominator,
      denominatorUnitCode: strengthParts.denominatorUnitCode,
    };
    current.ingredients.push(ingredient);
  });

  return [...groups.values()].map((group) => {
    const ingredientSeen = new Set();
    const ingredients = group.ingredients.filter((item) => {
      const key = [
        item.nameEn,
        item.strengthNumerator,
        item.numeratorUnitCode,
        item.strengthDenominator ?? "",
        item.denominatorUnitCode ?? "",
      ].join("|");
      if (ingredientSeen.has(key)) return false;
      ingredientSeen.add(key);
      return true;
    });

    if (!group.tradeName) {
      throw new Error(`Rows ${group.sourceRows.join(", ")}: tradeName is missing`);
    }
    if (!ingredients.length) {
      throw new Error(`Rows ${group.sourceRows.join(", ")}: no ingredients found`);
    }

    const dosageFormCode = normalizeDosageFormCode(group.dosageForm);
    const unitTypeCode =
      parseUnitTypeCodeFromPackaging(group.packagingDetail) ||
      (dosageFormCode === "ORAL_SOLUTION" ? "BOTTLE" : "TABLET");
    const reportGroupCode = normalizeCode(group.kyType);
    const packageSize = toNullableText(group.packagingAll || group.packagingDetail);
    const noteText =
      group.packagingDetail && group.packagingDetail !== packageSize ? group.packagingDetail : null;

    return {
      sourceRows: group.sourceRows,
      payload: {
        productCode: toNullableText(group.productCode),
        barcode: toNullableText(group.barcode),
        tradeName: group.tradeName,
        genericName: null,
        dosageFormCode,
        manufacturerName: toNullableText(group.manufacturer),
        packageSize,
        unitTypeCode,
        price: group.price,
        reportGroupCodes: reportGroupCode ? [reportGroupCode] : [],
        noteText,
        ingredients,
      },
    };
  });
}

function unitKindForCode(code, usage) {
  const normalized = normalizeCode(code);
  if (!normalized) return "PACKAGE";

  if (usage === "ingredient") {
    if (["ML"].includes(normalized)) return "VOLUME";
    if (["TABLET", "CAPSULE", "INHALATION"].includes(normalized)) return "COUNT";
    return "MASS";
  }

  if (["TABLET", "CAPSULE", "INHALATION"].includes(normalized)) return "COUNT";
  return "PACKAGE";
}

async function ensureRequiredUnitTypes(payloads) {
  const usageByCode = new Map();
  for (const item of payloads) {
    const unitTypeCode = normalizeCode(item.payload.unitTypeCode);
    if (unitTypeCode) {
      usageByCode.set(unitTypeCode, "package");
    }
    for (const ingredient of item.payload.ingredients) {
      const numerator = normalizeCode(ingredient.numeratorUnitCode);
      if (numerator && !usageByCode.has(numerator)) {
        usageByCode.set(numerator, "ingredient");
      }
      const denominator = normalizeCode(ingredient.denominatorUnitCode);
      if (denominator && !usageByCode.has(denominator)) {
        usageByCode.set(denominator, "ingredient");
      }
    }
  }

  const allCodes = [...usageByCode.keys()];
  if (!allCodes.length) return [];

  const existing = await query(
    `
      SELECT code
      FROM unit_types
      WHERE code = ANY($1::text[])
    `,
    [allCodes]
  );
  const existingCodes = new Set(existing.rows.map((row) => row.code));
  const created = [];

  for (const code of allCodes) {
    if (existingCodes.has(code)) continue;
    const usage = usageByCode.get(code) || "package";
    const unitKind = unitKindForCode(code, usage);
    const precisionScale = unitKind === "MASS" || unitKind === "VOLUME" ? 4 : 0;

    await query(
      `
        INSERT INTO unit_types (code, name_en, name_th, unit_kind, symbol, precision_scale, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (code) DO UPDATE
        SET is_active = true
      `,
      [code, code, code, unitKind, code.toLowerCase(), precisionScale]
    );
    created.push(code);
  }

  return created;
}

async function findExistingProductId(payload) {
  const productCode = toText(payload.productCode);
  const barcode = toText(payload.barcode);

  if (!productCode && !barcode) return null;

  const result = await query(
    `
      SELECT p.id
      FROM products p
      LEFT JOIN product_unit_levels pul ON pul.product_id = p.id
      WHERE ($1::text <> '' AND p.product_code = $1)
         OR ($2::text <> '' AND pul.barcode = $2)
      ORDER BY p.updated_at DESC
      LIMIT 1
    `,
    [productCode, barcode]
  );

  return result.rows[0]?.id || null;
}

function createResponseCollector() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return data;
    },
    send(data) {
      this.body = data;
      return data;
    },
  };
}

async function upsertProduct(payload) {
  const existingId = await findExistingProductId(payload);
  const res = createResponseCollector();

  if (existingId) {
    await updateProduct({ params: { id: existingId }, body: payload }, res);
    return { action: "updated", id: existingId, statusCode: res.statusCode };
  }

  await createProduct({ body: payload }, res);
  return {
    action: "created",
    id: res.body?.id || null,
    statusCode: res.statusCode,
  };
}

function parseArgs(argv) {
  const args = [...argv];
  const dryRun = args.includes("--dry-run");
  const cleanArgs = args.filter((arg) => arg !== "--dry-run");
  const filePath = cleanArgs[0];
  if (!filePath) {
    throw new Error("Usage: node server/scripts/importProductsFromXlsx.mjs <xlsx-path> [--dry-run]");
  }
  return { filePath, dryRun };
}

async function main() {
  const { filePath, dryRun } = parseArgs(process.argv.slice(2));
  const rows = parseXlsxRowsWithPython(filePath);
  const payloads = buildProductPayloads(rows);

  const summary = {
    rows: rows.length,
    products: payloads.length,
    created: 0,
    updated: 0,
    failed: [],
    createdUnitTypes: [],
  };

  if (dryRun) {
    let existingCount = 0;
    for (const item of payloads) {
      const existingId = await findExistingProductId(item.payload);
      if (existingId) existingCount += 1;
    }
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          rows: summary.rows,
          products: summary.products,
          wouldCreate: summary.products - existingCount,
          wouldUpdate: existingCount,
        },
        null,
        2
      )
    );
    return;
  }

  summary.createdUnitTypes = await ensureRequiredUnitTypes(payloads);

  for (const item of payloads) {
    try {
      const result = await upsertProduct(item.payload);
      if (result.action === "created") summary.created += 1;
      if (result.action === "updated") summary.updated += 1;
    } catch (error) {
      summary.failed.push({
        sourceRows: item.sourceRows,
        productCode: item.payload.productCode,
        barcode: item.payload.barcode,
        tradeName: item.payload.tradeName,
        message: error?.message || String(error),
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error?.message || error);
  process.exitCode = 1;
} finally {
  if (pool) {
    await pool.end().catch(() => {});
  }
}
