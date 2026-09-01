import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import pg from "pg";

const { Pool } = pg;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

function localDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const catalogTableCandidates = [
  "locations",
  "unit_types",
  "dosage_forms",
  "product_categories",
  "active_ingredients",
  "products",
  "product_ingredients",
  "product_unit_levels",
  "product_unit_conversions",
  "price_tiers",
  "product_prices",
  "report_groups",
  "product_report_groups",
  "product_report_receive_unit_levels",
  "dispensing_rules",
  "product_lots",
  "product_lot_allowed_unit_levels",
];

const defaultOutputDir = path.resolve(
  projectRoot,
  "..",
  "..",
  "SC-StockDay-Ordering",
  "data",
  "imports",
  `rx1011-drug-catalog-${localDateStamp()}`,
);

async function loadDatabaseConfig() {
  const merged = {};
  const loadedFiles = [];
  for (const relativePath of [".env", "server/.env"]) {
    const filePath = path.join(projectRoot, relativePath);
    try {
      const parsed = dotenv.parse(await fs.readFile(filePath));
      Object.assign(merged, parsed);
      loadedFiles.push(relativePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const connectionString =
    process.env.RX1011_DATABASE_URL ||
    process.env.DATABASE_URL ||
    merged.RX1011_DATABASE_URL ||
    merged.DATABASE_URL;

  if (!connectionString) {
    throw new Error("RX1011_DATABASE_URL or DATABASE_URL is not configured.");
  }

  const parsedUrl = new URL(connectionString);
  const ssl = /localhost|127\.0\.0\.1/i.test(parsedUrl.hostname)
    ? false
    : { rejectUnauthorized: false };

  return {
    connectionString,
    ssl,
    loadedFiles,
    safeTarget: {
      host: parsedUrl.hostname,
      port: parsedUrl.port || "5432",
      database: decodeURIComponent(parsedUrl.pathname.replace(/^\//, "")),
      source: process.env.RX1011_DATABASE_URL
        ? "process:RX1011_DATABASE_URL"
        : process.env.DATABASE_URL
          ? "process:DATABASE_URL"
          : merged.RX1011_DATABASE_URL
            ? "dotenv:RX1011_DATABASE_URL"
            : "dotenv:DATABASE_URL",
      loadedFiles,
    },
  };
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function normalizeCell(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return JSON.stringify(value);
  }
  return value;
}

function csvCell(value) {
  const normalized = normalizeCell(value);
  if (normalized === null) return "";
  if (typeof normalized === "boolean") return normalized ? "true" : "false";
  const text = String(normalized);
  if (text === "") return '""';
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function rowsToCsv(columns, rows) {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

async function writeCsv(outputDir, fileName, columns, rows) {
  const csv = rowsToCsv(columns, rows);
  const filePath = path.join(outputDir, fileName);
  await fs.writeFile(filePath, csv, "utf8");
  return { fileName, filePath, columns, rows, csv };
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return String(Number(numeric.toFixed(8)));
}

function buildFactorMaps(unitLevels, conversions) {
  const levelsByProduct = new Map();
  for (const level of unitLevels) {
    const rows = levelsByProduct.get(level.product_id) || [];
    rows.push(level);
    levelsByProduct.set(level.product_id, rows);
  }

  const conversionsByProduct = new Map();
  for (const conversion of conversions) {
    const rows = conversionsByProduct.get(conversion.product_id) || [];
    rows.push(conversion);
    conversionsByProduct.set(conversion.product_id, rows);
  }

  const factorsByProduct = new Map();
  for (const [productId, levels] of levelsByProduct) {
    const factors = new Map();
    for (const level of levels) {
      const qpb = /(?:^|\|)qpb=([0-9]+(?:\.[0-9]+)?)/i.exec(cleanText(level.unit_key));
      if (qpb) factors.set(level.id, Number(qpb[1]));
      if (level.is_base) factors.set(level.id, 1);
    }

    const productConversions = conversionsByProduct.get(productId) || [];
    for (let pass = 0; pass < levels.length + 2; pass += 1) {
      let changed = false;
      for (const conversion of productConversions) {
        const multiplier = Number(conversion.multiplier);
        const parent = factors.get(conversion.parent_unit_level_id);
        const child = factors.get(conversion.child_unit_level_id);
        if (Number.isFinite(child) && !Number.isFinite(parent)) {
          factors.set(conversion.parent_unit_level_id, child * multiplier);
          changed = true;
        } else if (Number.isFinite(parent) && !Number.isFinite(child) && multiplier !== 0) {
          factors.set(conversion.child_unit_level_id, parent / multiplier);
          changed = true;
        }
      }
      if (!changed) break;
    }
    factorsByProduct.set(productId, factors);
  }

  return { levelsByProduct, conversionsByProduct, factorsByProduct };
}

function ingredientSummary(row, ingredientById, unitTypeById) {
  const ingredient = ingredientById.get(row.active_ingredient_id);
  const numeratorUnit = unitTypeById.get(row.numerator_unit_id);
  const denominatorUnit = unitTypeById.get(row.denominator_unit_id);
  const name = ingredient?.name_en || ingredient?.name_th || ingredient?.code || "";
  const numerator = [formatNumber(row.strength_numerator), numeratorUnit?.symbol || numeratorUnit?.code]
    .filter(Boolean)
    .join(" ");
  const denominator = row.strength_denominator == null
    ? ""
    : `/${[formatNumber(row.strength_denominator), denominatorUnit?.symbol || denominatorUnit?.code]
      .filter(Boolean)
      .join(" ")}`;
  return `${name} ${numerator}${denominator}`.trim();
}

function buildDerivedExports(data) {
  const products = data.get("products") || [];
  const unitTypes = data.get("unit_types") || [];
  const dosageForms = data.get("dosage_forms") || [];
  const categories = data.get("product_categories") || [];
  const ingredients = data.get("active_ingredients") || [];
  const productIngredients = data.get("product_ingredients") || [];
  const unitLevels = data.get("product_unit_levels") || [];
  const conversions = data.get("product_unit_conversions") || [];
  const priceTiers = data.get("price_tiers") || [];
  const prices = data.get("product_prices") || [];
  const reportGroups = data.get("report_groups") || [];
  const productReportGroups = data.get("product_report_groups") || [];
  const locations = data.get("locations") || [];

  const unitTypeById = new Map(unitTypes.map((row) => [row.id, row]));
  const dosageFormById = new Map(dosageForms.map((row) => [row.id, row]));
  const categoryById = new Map(categories.map((row) => [row.id, row]));
  const ingredientById = new Map(ingredients.map((row) => [row.id, row]));
  const priceTierById = new Map(priceTiers.map((row) => [row.id, row]));
  const reportGroupById = new Map(reportGroups.map((row) => [row.id, row]));
  const locationById = new Map(locations.map((row) => [row.id, row]));
  const unitLevelById = new Map(unitLevels.map((row) => [row.id, row]));
  const productById = new Map(products.map((row) => [row.id, row]));
  const { levelsByProduct, conversionsByProduct, factorsByProduct } = buildFactorMaps(
    unitLevels,
    conversions,
  );

  const groupRows = (rows, key) => {
    const grouped = new Map();
    for (const row of rows) {
      const list = grouped.get(row[key]) || [];
      list.push(row);
      grouped.set(row[key], list);
    }
    return grouped;
  };
  const ingredientsByProduct = groupRows(productIngredients, "product_id");
  const pricesByProduct = groupRows(prices, "product_id");
  const reportGroupsByProduct = groupRows(productReportGroups, "product_id");

  const flatRows = products
    .slice()
    .sort((a, b) => cleanText(a.product_code).localeCompare(cleanText(b.product_code)) || cleanText(a.trade_name).localeCompare(cleanText(b.trade_name)))
    .map((product) => {
      const dosageForm = dosageFormById.get(product.dosage_form_id);
      const category = categoryById.get(product.product_category_id);
      const manufacturer = locationById.get(product.manufacturer_location_id);
      const productIngredientRows = (ingredientsByProduct.get(product.id) || [])
        .slice()
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
      const productUnitRows = (levelsByProduct.get(product.id) || [])
        .slice()
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
      const factorMap = factorsByProduct.get(product.id) || new Map();
      const productConversionRows = conversionsByProduct.get(product.id) || [];
      const productPriceRows = pricesByProduct.get(product.id) || [];
      const productGroupRows = reportGroupsByProduct.get(product.id) || [];

      const ingredientJson = productIngredientRows.map((row) => ({
        ingredient_code: ingredientById.get(row.active_ingredient_id)?.code || null,
        ingredient_name_en: ingredientById.get(row.active_ingredient_id)?.name_en || null,
        ingredient_name_th: ingredientById.get(row.active_ingredient_id)?.name_th || null,
        strength_numerator: row.strength_numerator,
        numerator_unit: unitTypeById.get(row.numerator_unit_id)?.code || null,
        strength_denominator: row.strength_denominator,
        denominator_unit: unitTypeById.get(row.denominator_unit_id)?.code || null,
        sort_order: row.sort_order,
      }));
      const unitJson = productUnitRows.map((row) => ({
        unit_level_id: row.id,
        code: row.code,
        display_name: row.display_name,
        unit_type_code: unitTypeById.get(row.unit_type_id)?.code || null,
        factor_to_base: factorMap.has(row.id) ? formatNumber(factorMap.get(row.id)) : null,
        is_base: row.is_base,
        is_sellable: row.is_sellable,
        is_active: row.is_active,
        sort_order: row.sort_order,
        barcode: row.barcode,
        unit_key: row.unit_key,
      }));
      const conversionJson = productConversionRows.map((row) => ({
        parent_unit_code: unitLevelById.get(row.parent_unit_level_id)?.code || null,
        child_unit_code: unitLevelById.get(row.child_unit_level_id)?.code || null,
        multiplier: row.multiplier,
      }));
      const priceJson = productPriceRows.map((row) => ({
        unit_code: unitLevelById.get(row.unit_level_id)?.code || null,
        price_tier_code: priceTierById.get(row.price_tier_id)?.code || null,
        price: row.price,
        currency_code: cleanText(row.currency_code),
        effective_from: row.effective_from,
        effective_to: row.effective_to,
      }));
      const groupJson = productGroupRows.map((row) => ({
        code: reportGroupById.get(row.report_group_id)?.code || null,
        thai_name: reportGroupById.get(row.report_group_id)?.thai_name || null,
        effective_from: row.effective_from,
        effective_to: row.effective_to,
      }));

      return {
        source_product_id: product.id,
        product_code: product.product_code,
        trade_name: product.trade_name,
        generic_name: product.generic_name,
        dosage_form_code: dosageForm?.code || null,
        dosage_form_name_en: dosageForm?.name_en || null,
        dosage_form_name_th: dosageForm?.name_th || null,
        dosage_form_group: dosageForm?.dosage_form_group || null,
        category_code: category?.code || null,
        category_name_en: category?.name_en || null,
        category_name_th: category?.name_th || null,
        manufacturer_code: manufacturer?.code || null,
        manufacturer_name: manufacturer?.name || null,
        is_controlled: product.is_controlled,
        is_active: product.is_active,
        note_text: product.note_text,
        ingredient_summary: productIngredientRows
          .map((row) => ingredientSummary(row, ingredientById, unitTypeById))
          .join("; "),
        ingredients_json: JSON.stringify(ingredientJson),
        packaging_summary: productUnitRows
          .map((row) => `${row.display_name}${factorMap.has(row.id) ? ` (factor=${formatNumber(factorMap.get(row.id))})` : ""}`)
          .join(" | "),
        unit_levels_json: JSON.stringify(unitJson),
        unit_conversions_json: JSON.stringify(conversionJson),
        report_groups: groupJson.map((row) => row.code).filter(Boolean).join("|"),
        report_groups_json: JSON.stringify(groupJson),
        prices_json: JSON.stringify(priceJson),
        report_receive_unit_code: unitLevelById.get(product.report_receive_unit_level_id)?.code || null,
        created_at: product.created_at,
        updated_at: product.updated_at,
      };
    });

  const stagingRows = flatRows.map((flat) => {
    const sourceProduct = productById.get(flat.source_product_id);
    const factorMap = factorsByProduct.get(flat.source_product_id) || new Map();
    const levels = (levelsByProduct.get(flat.source_product_id) || [])
      .filter((row) => row.is_active !== false)
      .slice()
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    const pick = (index) => levels[index] || null;
    const unit1 = pick(0);
    const unit2 = pick(1);
    const unit3 = pick(2);
    const extraUnits = levels.slice(3).map((level) => ({
      unit_level_id: level.id,
      code: level.code,
      display_name: level.display_name,
      factor_to_base: factorMap.has(level.id) ? formatNumber(factorMap.get(level.id)) : null,
      barcode: level.barcode,
      unit_key: level.unit_key,
    }));
    return {
      product_code: flat.product_code,
      product_name: flat.trade_name,
      product_name_eng: cleanText(flat.trade_name).split("(")[0].trim() || null,
      barcode_1: unit1?.barcode || null,
      barcode_2: unit2?.barcode || null,
      barcode_3: unit3?.barcode || null,
      supplier_code: null,
      supplier_name: null,
      unit_small: unit1?.display_name || null,
      factor_small: unit1 && factorMap.has(unit1.id) ? formatNumber(factorMap.get(unit1.id)) : null,
      unit_medium: unit2?.display_name || null,
      factor_medium: unit2 && factorMap.has(unit2.id) ? formatNumber(factorMap.get(unit2.id)) : null,
      unit_large: unit3?.display_name || null,
      factor_large: unit3 && factorMap.has(unit3.id) ? formatNumber(factorMap.get(unit3.id)) : null,
      extra_unit_levels_json: JSON.stringify(extraUnits),
      is_active: sourceProduct?.is_active ?? true,
      category: flat.category_name_th || flat.category_name_en || null,
      brand: null,
      rx1011_product_id: flat.source_product_id,
      generic_name: flat.generic_name,
      dosage_form: flat.dosage_form_code,
      is_controlled: flat.is_controlled,
      ingredient_summary: flat.ingredient_summary,
      manufacturer_code: flat.manufacturer_code,
      manufacturer_name: flat.manufacturer_name,
      source_note: "supplier fields intentionally left null; Rx1011 manufacturer is preserved separately; any unit levels beyond S/M/L are preserved in extra_unit_levels_json",
    };
  });

  const priceFlatRows = prices
    .slice()
    .sort((a, b) => cleanText(productById.get(a.product_id)?.product_code).localeCompare(cleanText(productById.get(b.product_id)?.product_code)))
    .map((row) => {
      const product = productById.get(row.product_id);
      const level = unitLevelById.get(row.unit_level_id);
      const tier = priceTierById.get(row.price_tier_id);
      const factorMap = factorsByProduct.get(row.product_id) || new Map();
      return {
        source_price_id: row.id,
        source_product_id: row.product_id,
        product_code: product?.product_code || null,
        trade_name: product?.trade_name || null,
        unit_level_id: row.unit_level_id,
        unit_code: level?.code || null,
        unit_name: level?.display_name || null,
        factor_to_base: level && factorMap.has(level.id) ? formatNumber(factorMap.get(level.id)) : null,
        price_tier_code: tier?.code || null,
        price_tier_name_en: tier?.name_en || null,
        price_tier_name_th: tier?.name_th || null,
        price: row.price,
        currency_code: cleanText(row.currency_code),
        effective_from: row.effective_from,
        effective_to: row.effective_to,
      };
    });

  return {
    flatRows,
    stagingRows,
    priceFlatRows,
    factorsByProduct,
    levelsByProduct,
  };
}

function validateCsvFiles(csvFiles) {
  return csvFiles.map((file) => {
    const records = parse(file.csv, {
      bom: true,
      relax_column_count: false,
      skip_empty_lines: true,
    });
    const header = records[0] || [];
    const dataRowCount = Math.max(records.length - 1, 0);
    const headerMatches =
      header.length === file.columns.length &&
      header.every((column, index) => column === file.columns[index]);
    const rowCountMatches = dataRowCount === file.rows.length;

    return {
      file_name: file.fileName,
      status: headerMatches && rowCountMatches ? "PASS" : "FAIL",
      expected_data_rows: file.rows.length,
      expected_columns: file.columns.length,
    };
  });
}

async function exportCatalog(outputDir = defaultOutputDir) {
  const config = await loadDatabaseConfig();
  const pool = new Pool({ connectionString: config.connectionString, ssl: config.ssl });
  const client = await pool.connect();
  const csvFiles = [];
  try {
    await fs.mkdir(outputDir, { recursive: true });
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

    const snapshotResult = await client.query("SELECT now() AS exported_at, current_database() AS database_name");
    const tableResult = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const existing = new Set(tableResult.rows.map((row) => row.table_name));

    const exportDefinitions = [
      {
        sourceTable: "locations",
        fileName: "manufacturer_locations.csv",
        importOrder: 1,
        query: `WITH RECURSIVE seed_ids AS (
                  SELECT manufacturer_location_id AS id FROM products WHERE manufacturer_location_id IS NOT NULL
                  UNION
                  SELECT manufacturer_location_id AS id FROM product_lots WHERE manufacturer_location_id IS NOT NULL
                ), relevant_ids AS (
                  SELECT id FROM seed_ids
                  UNION
                  SELECT l.parent_location_id
                  FROM locations l
                  JOIN relevant_ids r ON r.id = l.id
                  WHERE l.parent_location_id IS NOT NULL
                )
                SELECT l.*
                FROM locations l
                JOIN relevant_ids r ON r.id = l.id
                ORDER BY l.parent_location_id NULLS FIRST, l.code`,
        notes: "Filtered to manufacturer locations referenced by products or product lots; branch/customer locations excluded.",
      },
      { sourceTable: "unit_types", fileName: "unit_types.csv", importOrder: 2, orderBy: "code" },
      { sourceTable: "dosage_forms", fileName: "dosage_forms.csv", importOrder: 3, orderBy: "parent_form_id NULLS FIRST, code" },
      { sourceTable: "product_categories", fileName: "product_categories.csv", importOrder: 4, orderBy: "code" },
      { sourceTable: "active_ingredients", fileName: "active_ingredients.csv", importOrder: 5, orderBy: "code" },
      { sourceTable: "price_tiers", fileName: "price_tiers.csv", importOrder: 6, orderBy: "priority, code" },
      { sourceTable: "report_groups", fileName: "report_groups.csv", importOrder: 7, orderBy: "code" },
      {
        sourceTable: "products",
        fileName: "products.csv",
        importOrder: 8,
        orderBy: "product_code NULLS LAST, id",
        notes: "report_receive_unit_level_id creates a circular dependency; load through staging or defer this column until product_unit_levels is loaded.",
      },
      { sourceTable: "product_ingredients", fileName: "product_ingredients.csv", importOrder: 9, orderBy: "product_id, sort_order, id" },
      { sourceTable: "product_unit_levels", fileName: "product_unit_levels.csv", importOrder: 10, orderBy: "product_id, sort_order, id" },
      { sourceTable: "product_unit_conversions", fileName: "product_unit_conversions.csv", importOrder: 11, orderBy: "product_id, id" },
      { sourceTable: "product_prices", fileName: "product_prices.csv", importOrder: 12, orderBy: "product_id, price_tier_id, unit_level_id, effective_from" },
      { sourceTable: "product_report_groups", fileName: "product_report_groups.csv", importOrder: 13, orderBy: "product_id, report_group_id, effective_from" },
      { sourceTable: "dispensing_rules", fileName: "dispensing_rules.csv", importOrder: 14, orderBy: "priority, rule_name" },
      { sourceTable: "product_lots", fileName: "product_lots.csv", importOrder: 15, orderBy: "product_id, exp_date, lot_no" },
      { sourceTable: "product_lot_allowed_unit_levels", fileName: "product_lot_allowed_unit_levels.csv", importOrder: 16, orderBy: "product_id, product_lot_id, unit_level_id" },
    ].filter((definition) => existing.has(definition.sourceTable));

    const data = new Map();
    const manifestRows = [];
    for (const definition of exportDefinitions) {
      const sql = definition.query || `SELECT * FROM ${quoteIdentifier(definition.sourceTable)} ORDER BY ${definition.orderBy || "1"}`;
      const result = await client.query(sql);
      const columns = result.fields.map((field) => field.name);
      const file = await writeCsv(outputDir, definition.fileName, columns, result.rows);
      csvFiles.push(file);
      data.set(definition.sourceTable, result.rows);
      manifestRows.push({
        import_order: definition.importOrder,
        file_name: definition.fileName,
        source_table: definition.sourceTable,
        row_count: result.rows.length,
        column_count: columns.length,
        data_scope: "drug_catalog",
        notes: definition.notes || "Raw normalized table snapshot.",
      });
    }

    const schemaResult = await client.query(
      `SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name, ordinal_position`,
      [exportDefinitions.map((definition) => definition.sourceTable)],
    );
    csvFiles.push(await writeCsv(
      outputDir,
      "source_schema_columns.csv",
      schemaResult.fields.map((field) => field.name),
      schemaResult.rows,
    ));

    const derived = buildDerivedExports(data);
    const flatColumns = [
      "source_product_id", "product_code", "trade_name", "generic_name", "dosage_form_code",
      "dosage_form_name_en", "dosage_form_name_th", "dosage_form_group", "category_code",
      "category_name_en", "category_name_th", "manufacturer_code", "manufacturer_name",
      "is_controlled", "is_active", "note_text", "ingredient_summary", "ingredients_json",
      "packaging_summary", "unit_levels_json", "unit_conversions_json", "report_groups",
      "report_groups_json", "prices_json", "report_receive_unit_code", "created_at", "updated_at",
    ];
    csvFiles.push(await writeCsv(outputDir, "rx1011_drug_catalog_flat.csv", flatColumns, derived.flatRows));

    const stagingColumns = [
      "product_code", "product_name", "product_name_eng", "barcode_1", "barcode_2", "barcode_3",
      "supplier_code", "supplier_name", "unit_small", "factor_small", "unit_medium", "factor_medium",
      "unit_large", "factor_large", "extra_unit_levels_json", "is_active", "category", "brand", "rx1011_product_id",
      "generic_name", "dosage_form", "is_controlled", "ingredient_summary", "manufacturer_code",
      "manufacturer_name", "source_note",
    ];
    csvFiles.push(await writeCsv(
      outputDir,
      "sc_stockday_products_staging.csv",
      stagingColumns,
      derived.stagingRows,
    ));

    const priceFlatColumns = [
      "source_price_id", "source_product_id", "product_code", "trade_name", "unit_level_id",
      "unit_code", "unit_name", "factor_to_base", "price_tier_code", "price_tier_name_en",
      "price_tier_name_th", "price", "currency_code", "effective_from", "effective_to",
    ];
    csvFiles.push(await writeCsv(
      outputDir,
      "rx1011_product_prices_flat.csv",
      priceFlatColumns,
      derived.priceFlatRows,
    ));

    const qcResult = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE product_code IS NULL OR btrim(product_code) = '')::bigint AS blank_product_codes,
         (COUNT(*) - COUNT(DISTINCT product_code))::bigint AS duplicate_product_codes,
         COUNT(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM product_unit_levels pul WHERE pul.product_id = products.id
         ))::bigint AS products_without_unit_levels,
         COUNT(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM product_ingredients pi WHERE pi.product_id = products.id
         ))::bigint AS products_without_ingredients,
         COUNT(*) FILTER (
           WHERE product_code ILIKE '%999999%'
              OR trade_name ~* '(test|dummy|sample)'
         )::bigint AS test_like_products
       FROM products`,
    );
    const qc = qcResult.rows[0];
    let missingFactors = 0;
    let expectedExtraUnitLevels = 0;
    for (const [productId, levels] of derived.levelsByProduct) {
      const factors = derived.factorsByProduct.get(productId) || new Map();
      missingFactors += levels.filter((level) => !factors.has(level.id)).length;
      expectedExtraUnitLevels += Math.max(0, levels.filter((level) => level.is_active !== false).length - 3);
    }
    const capturedExtraUnitLevels = derived.stagingRows.reduce((total, row) => {
      const parsed = JSON.parse(row.extra_unit_levels_json || "[]");
      return total + parsed.length;
    }, 0);
    const qualityRows = [
      { check_name: "products_match_flat_export", status: derived.flatRows.length === (data.get("products") || []).length ? "PASS" : "FAIL", value: derived.flatRows.length, expected: (data.get("products") || []).length, details: "One flat row per source product." },
      { check_name: "blank_product_codes", status: Number(qc.blank_product_codes) === 0 ? "PASS" : "WARN", value: qc.blank_product_codes, expected: 0, details: "Blank codes complicate upsert into SC-StockDay-Ordering." },
      { check_name: "duplicate_product_codes", status: Number(qc.duplicate_product_codes) === 0 ? "PASS" : "FAIL", value: qc.duplicate_product_codes, expected: 0, details: "Product code should be unique for PostgreSQL staging/upsert." },
      { check_name: "products_without_unit_levels", status: Number(qc.products_without_unit_levels) === 0 ? "PASS" : "WARN", value: qc.products_without_unit_levels, expected: 0, details: "Packaging/unit data missing." },
      { check_name: "products_without_ingredients", status: Number(qc.products_without_ingredients) === 0 ? "PASS" : "WARN", value: qc.products_without_ingredients, expected: 0, details: "Ingredient relationship missing." },
      { check_name: "unit_levels_without_factor_to_base", status: missingFactors === 0 ? "PASS" : "WARN", value: missingFactors, expected: 0, details: "Factor derived from unit_key qpb token and/or product_unit_conversions." },
      { check_name: "staging_extra_unit_levels_captured", status: capturedExtraUnitLevels === expectedExtraUnitLevels ? "PASS" : "FAIL", value: capturedExtraUnitLevels, expected: expectedExtraUnitLevels, details: "Unit levels beyond the target S/M/L slots are preserved in extra_unit_levels_json." },
      { check_name: "test_like_products", status: Number(qc.test_like_products) === 0 ? "PASS" : "WARN", value: qc.test_like_products, expected: 0, details: "Included because this is a complete export; review test-like rows before production import." },
    ];

    const manifestColumns = [
      "import_order", "file_name", "source_table", "row_count", "column_count", "data_scope", "notes",
    ];
    const derivedStart = Math.max(...manifestRows.map((row) => row.import_order), 0) + 1;
    manifestRows.push(
      { import_order: derivedStart, file_name: "rx1011_drug_catalog_flat.csv", source_table: "derived", row_count: derived.flatRows.length, column_count: flatColumns.length, data_scope: "one_row_per_product", notes: "Recommended general staging file; nested relationships are JSON text columns." },
      { import_order: derivedStart + 1, file_name: "sc_stockday_products_staging.csv", source_table: "derived", row_count: derived.stagingRows.length, column_count: stagingColumns.length, data_scope: "SC-StockDay-Ordering staging", notes: "Columns align closely with SC products; supplier fields intentionally null because manufacturer is not necessarily supplier." },
      { import_order: derivedStart + 2, file_name: "rx1011_product_prices_flat.csv", source_table: "derived", row_count: derived.priceFlatRows.length, column_count: priceFlatColumns.length, data_scope: "one_row_per_price", notes: "Use as price staging; preserve Rx1011 tier semantics before mapping to retail/wholesale." },
      { import_order: derivedStart + 3, file_name: "source_schema_columns.csv", source_table: "information_schema.columns", row_count: schemaResult.rows.length, column_count: schemaResult.fields.length, data_scope: "metadata", notes: "PostgreSQL source types for the normalized CSV files." },
      { import_order: derivedStart + 4, file_name: "quality_checks.csv", source_table: "derived", row_count: qualityRows.length, column_count: 5, data_scope: "quality_control", notes: "Read before import." },
    );
    const manifestFile = await writeCsv(outputDir, "export_manifest.csv", manifestColumns, manifestRows);
    csvFiles.push(manifestFile);

    const qualityColumns = ["check_name", "status", "value", "expected", "details"];
    const qualityFile = await writeCsv(outputDir, "quality_checks.csv", qualityColumns, qualityRows);
    csvFiles.push(qualityFile);

    const metadataRows = [
      { key: "source_host", value: config.safeTarget.host },
      { key: "source_database", value: snapshotResult.rows[0].database_name },
      { key: "exported_at", value: snapshotResult.rows[0].exported_at },
      { key: "encoding", value: "UTF-8 (no BOM)" },
      { key: "line_ending", value: "CRLF" },
      { key: "null_representation", value: "unquoted empty field" },
      { key: "empty_string_representation", value: "quoted empty string" },
      { key: "excluded_scope", value: "patients, users, dispensing transactions, stock movements, audit logs" },
    ];
    const metadataFile = await writeCsv(outputDir, "export_metadata.csv", ["key", "value"], metadataRows);
    csvFiles.push(metadataFile);

    await client.query("COMMIT");

    const validationRows = validateCsvFiles(csvFiles);
    const validationFile = await writeCsv(
      outputDir,
      "csv_validation.csv",
      ["file_name", "status", "expected_data_rows", "expected_columns"],
      validationRows,
    );
    csvFiles.push(validationFile);

    console.log(JSON.stringify({
      outputDir,
      source: config.safeTarget,
      exportedAt: snapshotResult.rows[0].exported_at,
      products: (data.get("products") || []).length,
      files: csvFiles.map((file) => ({ fileName: file.fileName, rows: file.rows.length })),
      qualityChecks: qualityRows,
    }, null, 2));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors after a completed commit or broken connection.
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function probe() {
  const config = await loadDatabaseConfig();
  const pool = new Pool({ connectionString: config.connectionString, ssl: config.ssl });
  try {
    const databaseResult = await pool.query(
      "SELECT current_database() AS database_name, current_schema() AS schema_name, version() AS version",
    );
    const tableResult = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const existing = new Set(tableResult.rows.map((row) => row.table_name));
    const catalogTables = catalogTableCandidates.filter((table) => existing.has(table));

    const tables = [];
    for (const table of catalogTables) {
      const [countResult, columnResult] = await Promise.all([
        pool.query(`SELECT COUNT(*)::bigint AS row_count FROM ${quoteIdentifier(table)}`),
        pool.query(
          `SELECT column_name, data_type, udt_name, is_nullable, ordinal_position
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1
           ORDER BY ordinal_position`,
          [table],
        ),
      ]);
      tables.push({
        table,
        rowCount: Number(countResult.rows[0].row_count),
        columns: columnResult.rows,
      });
    }

    console.log(JSON.stringify({
      target: config.safeTarget,
      database: databaseResult.rows[0],
      tables,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

const command = process.argv[2] || "help";
if (command === "help" || command === "--help" || command === "-h") {
  console.log([
    "Rx1011 drug catalog export (read-only database access)",
    "",
    "Usage:",
    "  node scripts/export-drug-catalog.mjs probe",
    "  node scripts/export-drug-catalog.mjs export [output-directory]",
    "",
    `Default output: ${defaultOutputDir}`,
    "Database config: RX1011_DATABASE_URL or DATABASE_URL from the environment, .env, or server/.env",
  ].join("\n"));
} else if (command === "probe") {
  await probe();
} else if (command === "export") {
  await exportCatalog(process.argv[3] ? path.resolve(process.argv[3]) : defaultOutputDir);
} else {
  throw new Error(`Unknown command: ${command}`);
}
