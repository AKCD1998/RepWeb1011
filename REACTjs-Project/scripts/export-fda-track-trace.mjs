#!/usr/bin/env node
import { spawnSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const defaultMasterXlsx =
  "c:\\Users\\scgro\\OneDrive\\Documents\\fda_track_trace_md_first-draft.xlsx";
const defaultTransactionTemplateXlsx =
  "c:\\Users\\scgro\\OneDrive\\Documents\\transaction_sn_template.xlsx";
const defaultMappingJson = path.join(projectRoot, "config", "fda-track-trace-map.json");

const workbookWriterPython = String.raw`
import copy
import json
import sys
from pathlib import Path

import openpyxl


PACKAGING_SHEET = "บรรจุภัณฑ์"
PARTNER_SHEET = "คู่ค้า"
TRANSACTION_DATA_SHEET = "กรอกข้อมูลที่ชีทนี้"


def clean(value):
    if value is None:
        return ""
    text = str(value).strip()
    if text.upper() == "NULL":
        return ""
    return text


def normalize_code(value):
    return clean(value).replace(" ", "").upper()


def normalize_header(value):
    return clean(value).replace(" ", "").replace("_", "").lower()


def get_field(data, *names):
    wanted = {normalize_header(name) for name in names}
    for key, value in data.items():
        if normalize_header(key) in wanted:
            return clean(value)
    return ""


def read_table(ws):
    headers = [clean(cell.value) for cell in ws[1]]
    rows = []
    for row_index, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        values = list(row[: len(headers)])
        if not any(clean(value) for value in values):
            continue
        rows.append(
            {
                "rowNumber": row_index,
                "values": [clean(value) for value in values],
                "data": {headers[i]: clean(values[i]) for i in range(len(headers))},
            }
        )
    return headers, rows


def clone_row_style(ws, source_row, target_row, col_count):
    for col in range(1, col_count + 1):
        source_cell = ws.cell(source_row, col)
        target_cell = ws.cell(target_row, col)
        if source_cell.has_style:
            target_cell._style = copy.copy(source_cell._style)
        if source_cell.number_format:
            target_cell.number_format = source_cell.number_format
        if source_cell.alignment:
            target_cell.alignment = copy.copy(source_cell.alignment)
        if source_cell.fill:
            target_cell.fill = copy.copy(source_cell.fill)
        if source_cell.border:
            target_cell.border = copy.copy(source_cell.border)
        if source_cell.font:
            target_cell.font = copy.copy(source_cell.font)


def clear_data_rows(ws, min_row=2):
    if ws.max_row >= min_row:
        ws.delete_rows(min_row, ws.max_row - min_row + 1)


def append_rows_with_style(ws, rows, template_row=2):
    max_cols = ws.max_column
    for row_values in rows:
        target_row = ws.max_row + 1
        if ws.max_row < template_row:
            target_row = template_row
        clone_row_style(ws, template_row, target_row, max_cols)
        for col, value in enumerate(row_values, start=1):
            ws.cell(target_row, col, value)


def find_packaging_matches(rows, payload):
    barcode = payload.get("barcode", "")
    target = normalize_code(barcode)
    product = payload.get("product") or {}
    trade_name = clean(product.get("tradeName")).upper()
    product_code = clean(payload.get("productCode")).upper()
    if not target:
        target = ""
    matches = []
    for row in rows:
        data = row["data"]
        gtin = normalize_code(get_field(data, "Gtin", "GTIN"))
        package_code = normalize_code(get_field(data, "PackageCode", "Package Code"))
        recipe_code = normalize_code(get_field(data, "RecipeNewCode", "Recipe New Code"))
        name_en = clean(get_field(data, "ProductNameMainEn", "productNameMainEn")).upper()
        name_th = clean(get_field(data, "ProductNameMainTh", "productNameMainTh"))

        if target and (gtin == target or package_code == target):
            matches.append(row)
            continue

        if not target and product_code and recipe_code == product_code:
            matches.append(row)
            continue

        if not target and name_en and name_en in trade_name:
            matches.append(row)
            continue

        if not target and name_th and name_th in trade_name:
            matches.append(row)
    return matches


def summarize_packaging_row(row):
    if not row:
        return None
    data = row["data"]
    return {
        "sourceRow": row["rowNumber"],
        "RegisterLicense": get_field(data, "RegisterLicense", "Register License"),
        "RecipeNewCode": get_field(data, "RecipeNewCode", "Recipe New Code"),
        "ProductNameMainTh": get_field(data, "ProductNameMainTh", "productNameMainTh"),
        "ProductNameMainEn": get_field(data, "ProductNameMainEn", "productNameMainEn"),
        "ProductType": get_field(data, "ProductType", "Product Type"),
        "Level": get_field(data, "Level"),
        "DescriptionSystem": get_field(data, "DescriptionSystem", "Description System"),
        "Gtin": get_field(data, "Gtin", "GTIN"),
        "PackageCode": get_field(data, "PackageCode", "Package Code"),
        "QuantityPerParentUnit": get_field(data, "QuantityPerParentUnit", "Quantity Per Parent Unit"),
        "QuantityPerBaseUnit": get_field(data, "QuantityPerBaseUnit", "Quantity Per Base Unit"),
    }


def find_partner_code(transaction_rows, packaging_matches, barcode):
    target_codes = {normalize_code(barcode)}
    for row in packaging_matches:
        data = row["data"]
        target_codes.add(normalize_code(get_field(data, "Gtin", "GTIN")))
        target_codes.add(normalize_code(get_field(data, "PackageCode", "Package Code")))
    target_codes.discard("")

    for row in transaction_rows:
        values = row["values"]
        first_col = normalize_code(values[0] if len(values) > 0 else "")
        partner_code = clean(values[1] if len(values) > 1 else "")
        if first_col in target_codes and partner_code:
            return {
                "partnerCode": partner_code,
                "source": f"transaction template row {row['rowNumber']}",
            }

    return {"partnerCode": "", "source": ""}


def find_partner_from_mapping(payload):
    mapping = payload.get("partnerMapping") or {}
    product_code = clean(payload.get("productCode"))
    barcode = clean(payload.get("barcode"))

    product_codes = mapping.get("productPartnerCodes") or {}
    if product_code and product_code in product_codes:
        return {
            "partnerCode": clean(product_codes.get(product_code)),
            "source": f"mapping productPartnerCodes.{product_code}",
        }

    barcode_codes = mapping.get("barcodePartnerCodes") or {}
    if barcode and barcode in barcode_codes:
        return {
            "partnerCode": clean(barcode_codes.get(barcode)),
            "source": f"mapping barcodePartnerCodes.{barcode}",
        }

    return {"partnerCode": "", "source": ""}


def find_partner_record(partner_rows, partner_code, mapping):
    normalized_partner_code = normalize_code(partner_code)
    for row in partner_rows:
        values = row["values"]
        first_col = values[0] if values else ""
        if normalize_code(first_col) == normalized_partner_code:
            return {
                "source": f"{PARTNER_SHEET} row {row['rowNumber']}",
                "data": row["data"],
            }

    partners = (mapping or {}).get("partners") or {}
    mapped = partners.get(partner_code)
    if isinstance(mapped, dict):
        return {
            "source": f"mapping partners.{partner_code}",
            "data": mapped,
        }

    return {"source": "", "data": None}


def make_serial_value(serial_mode, product_code, lot_no, sequence):
    if serial_mode == "blank":
        return ""
    if serial_mode == "prefixed":
        safe_lot = clean(lot_no).replace(" ", "_") or "NOLOT"
        return f"{product_code}-{safe_lot}-{sequence:06d}"
    return str(sequence)


def expand_transaction_rows(payload, identifier, partner_code):
    warnings = []
    rows = []
    sequence_by_lot = {}
    movement_summaries = []
    lot_expiry = {}

    for movement in payload.get("movements", []):
        lot_no = clean(movement.get("lotNo")) or "ไม่ระบุ lot"
        exp_date = clean(movement.get("expDate"))
        quantity = float(movement.get("quantity") or 0)
        integer_quantity = int(quantity)

        if abs(quantity - integer_quantity) > 0.0001:
            warnings.append(
                f"Movement {movement.get('id')} lot {lot_no} has non-integer quantity {quantity}; it was not expanded to S/N rows."
            )
            continue

        if integer_quantity <= 0:
            warnings.append(
                f"Movement {movement.get('id')} lot {lot_no} has non-positive quantity {quantity}; it was skipped."
            )
            continue

        previous_exp = lot_expiry.get(lot_no)
        if previous_exp and exp_date and previous_exp != exp_date:
            warnings.append(
                f"Lot {lot_no} appears with multiple expiry dates ({previous_exp}, {exp_date}), but transaction_sn_template has no expiry column."
            )
        elif exp_date:
            lot_expiry[lot_no] = exp_date

        first_sequence = sequence_by_lot.get(lot_no, 0) + 1
        for offset in range(integer_quantity):
            sequence = first_sequence + offset
            rows.append(
                [
                    identifier,
                    partner_code,
                    lot_no,
                    make_serial_value(
                        payload.get("serialMode", "sequence"),
                        payload.get("productCode", ""),
                        lot_no,
                        sequence,
                    ),
                ]
            )
        sequence_by_lot[lot_no] = first_sequence + integer_quantity - 1
        movement_summaries.append(
            {
                "movementId": movement.get("id"),
                "movementType": movement.get("movementType"),
                "occurredAt": movement.get("occurredAt"),
                "fromCode": movement.get("fromCode"),
                "toCode": movement.get("toCode"),
                "lotNo": lot_no,
                "expDate": exp_date,
                "quantity": integer_quantity,
                "firstGeneratedSerial": make_serial_value(
                    payload.get("serialMode", "sequence"),
                    payload.get("productCode", ""),
                    lot_no,
                    first_sequence,
                ),
                "lastGeneratedSerial": make_serial_value(
                    payload.get("serialMode", "sequence"),
                    payload.get("productCode", ""),
                    lot_no,
                    sequence_by_lot[lot_no],
                ),
            }
        )

    return rows, movement_summaries, warnings


def main():
    payload_path = Path(sys.argv[1])
    payload = json.loads(payload_path.read_text(encoding="utf-8"))

    master_path = Path(payload["masterXlsx"])
    transaction_template_path = Path(payload["transactionTemplateXlsx"])
    output_master_path = Path(payload["outputMasterXlsx"])
    output_transaction_path = Path(payload["outputTransactionXlsx"])
    output_report_path = Path(payload["outputReportJson"])

    master_wb = openpyxl.load_workbook(master_path)
    transaction_wb = openpyxl.load_workbook(transaction_template_path)

    if PACKAGING_SHEET not in master_wb.sheetnames:
        raise RuntimeError(f"Missing sheet: {PACKAGING_SHEET}")
    if TRANSACTION_DATA_SHEET not in transaction_wb.sheetnames:
        raise RuntimeError(f"Missing sheet: {TRANSACTION_DATA_SHEET}")

    packaging_ws = master_wb[PACKAGING_SHEET]
    packaging_headers, packaging_rows = read_table(packaging_ws)
    packaging_matches = find_packaging_matches(packaging_rows, payload)
    partner_headers, partner_rows = read_table(master_wb[PARTNER_SHEET]) if PARTNER_SHEET in master_wb.sheetnames else ([], [])

    transaction_data_ws = transaction_wb[TRANSACTION_DATA_SHEET]
    _, transaction_template_rows = read_table(transaction_data_ws)

    partner_code = clean(payload.get("partnerCode"))
    partner_source = "command line --partner-code" if partner_code else ""
    if not partner_code:
        partner = find_partner_from_mapping(payload)
        partner_code = partner["partnerCode"]
        partner_source = partner["source"]
    if not partner_code:
        partner = find_partner_code(transaction_template_rows, packaging_matches, payload.get("barcode", ""))
        partner_code = partner["partnerCode"]
        partner_source = partner["source"]
    partner_record = find_partner_record(partner_rows, partner_code, payload.get("partnerMapping") or {}) if partner_code else {"source": "", "data": None}

    identifier = clean(payload.get("identifier"))
    identifier_source = "command line --identifier" if identifier else ""
    if not identifier and packaging_matches:
        selected_packaging = summarize_packaging_row(packaging_matches[0]) or {}
        identifier_type = clean(payload.get("identifierType")).lower() or "gtin"
        if identifier_type == "package-code":
            identifier = clean(selected_packaging.get("PackageCode"))
            identifier_source = f"{PACKAGING_SHEET} row {packaging_matches[0]['rowNumber']} PackageCode"
        else:
            identifier = clean(selected_packaging.get("Gtin"))
            identifier_source = f"{PACKAGING_SHEET} row {packaging_matches[0]['rowNumber']} Gtin"
        if not identifier:
            identifier = clean(selected_packaging.get("Gtin") or selected_packaging.get("PackageCode"))
            identifier_source = f"{PACKAGING_SHEET} row {packaging_matches[0]['rowNumber']} Gtin/PackageCode fallback"
    if not identifier:
        identifier = clean(payload.get("barcode"))
        identifier_source = "database product_unit_levels.barcode"

    warnings = []
    if not packaging_matches:
        warnings.append(
            f"No packaging row in {master_path.name} matched barcode/GTIN {payload.get('barcode') or '-'}."
        )
    if len(packaging_matches) > 1:
        warnings.append(
            f"Multiple packaging rows matched barcode/GTIN {payload.get('barcode')}; all matched rows were kept in the master draft."
        )
    if not partner_code:
        warnings.append("No partner code could be resolved. The transaction workbook partner column is blank.")
    elif not partner_record["data"]:
        warnings.append(
            f"Partner code {partner_code} is mapped for transaction rows, but no partner detail row was found in the master workbook or mapping JSON."
        )
    if payload.get("serialMode", "sequence") != "blank":
        warnings.append(
            "S/N values were generated by sequence from repo movement quantities; the current database has no actual per-item serial-number table."
        )

    transaction_rows, movement_summaries, row_warnings = expand_transaction_rows(
        payload,
        identifier,
        partner_code,
    )
    warnings.extend(row_warnings)

    matched_master_values = []
    for row in packaging_matches:
        data = row["data"]
        matched_master_values.append([data.get(header, "") for header in packaging_headers])

    clear_data_rows(packaging_ws, min_row=2)
    append_rows_with_style(packaging_ws, matched_master_values, template_row=2)

    clear_data_rows(transaction_data_ws, min_row=2)
    append_rows_with_style(transaction_data_ws, transaction_rows, template_row=2)

    output_master_path.parent.mkdir(parents=True, exist_ok=True)
    output_transaction_path.parent.mkdir(parents=True, exist_ok=True)
    master_wb.save(output_master_path)
    transaction_wb.save(output_transaction_path)

    report = {
        "productCode": payload.get("productCode"),
        "product": payload.get("product"),
        "barcode": payload.get("barcode"),
        "identifier": identifier,
        "identifierSource": identifier_source,
        "partnerCode": partner_code,
        "partnerSource": partner_source,
        "partnerRecord": partner_record,
        "selectedPackaging": summarize_packaging_row(packaging_matches[0]) if packaging_matches else None,
        "movementType": payload.get("movementType"),
        "branchCode": payload.get("branchCode"),
        "dateFrom": payload.get("dateFrom"),
        "dateTo": payload.get("dateTo"),
        "serialMode": payload.get("serialMode"),
        "packagingMatches": [
            {
                "sourceRow": row["rowNumber"],
                "summary": summarize_packaging_row(row),
                "data": row["data"],
            }
            for row in packaging_matches
        ],
        "transactionRowCount": len(transaction_rows),
        "movementSummaries": movement_summaries,
        "warnings": warnings,
        "outputs": {
            "masterXlsx": str(output_master_path),
            "transactionXlsx": str(output_transaction_path),
            "reportJson": str(output_report_path),
        },
    }

    output_report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
`;

function parseArgs(argv) {
    const options = {
    productCode: "",
    masterXlsx: defaultMasterXlsx,
    transactionTemplateXlsx: defaultTransactionTemplateXlsx,
    mappingJson: defaultMappingJson,
    outDir: path.join(projectRoot, "tmp", "fda-track-trace"),
    movementType: "RECEIVE",
    serialMode: "sequence",
    identifierType: "gtin",
    partnerCode: "",
    identifier: "",
    branchCode: "",
    dateFrom: "",
    dateTo: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--") && !options.productCode) {
      options.productCode = token;
      continue;
    }

    const [rawKey, inlineValue] = token.split("=", 2);
    const key = rawKey.replace(/^--/, "");
    const readValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      return argv[index] || "";
    };

    if (key === "master-xlsx") options.masterXlsx = readValue();
    else if (key === "transaction-template-xlsx") options.transactionTemplateXlsx = readValue();
    else if (key === "mapping-json") options.mappingJson = readValue();
    else if (key === "out-dir") options.outDir = readValue();
    else if (key === "movement-type") options.movementType = readValue().toUpperCase();
    else if (key === "serial-mode") options.serialMode = readValue();
    else if (key === "identifier-type") options.identifierType = readValue().toLowerCase();
    else if (key === "partner-code") options.partnerCode = readValue();
    else if (key === "identifier") options.identifier = readValue();
    else if (key === "branch-code") options.branchCode = readValue();
    else if (key === "date-from") options.dateFrom = readValue();
    else if (key === "date-to") options.dateTo = readValue();
    else if (key === "help" || key === "h") options.help = true;
    else throw new Error(`Unknown option: ${token}`);
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/export-fda-track-trace.mjs <product-code> [options]

Options:
  --master-xlsx <path>                  Source FDA master workbook
  --transaction-template-xlsx <path>    Source transaction S/N template workbook
  --mapping-json <path>                 Export-only FDA partner mapping JSON
  --out-dir <path>                      Output folder (default: tmp/fda-track-trace)
  --movement-type <type>                RECEIVE, DISPENSE, TRANSFER_IN, TRANSFER_OUT, ADJUST
  --branch-code <code>                  Optional branch filter
  --date-from <YYYY-MM-DD>              Optional movement start date
  --date-to <YYYY-MM-DD>                Optional movement end date, inclusive
  --partner-code <code>                 Override partner code
  --identifier <code>                   Override package identifier / GTIN
  --identifier-type <gtin|package-code> Identifier to use from Track & Trace master when --identifier is absent
  --serial-mode <sequence|prefixed|blank>
`);
}

async function loadPartnerMapping(mappingJson) {
  const mappingPath = toCleanText(mappingJson);
  if (!mappingPath) return {};

  try {
    const text = await fs.readFile(path.resolve(mappingPath), "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Failed to read --mapping-json: ${error.message}`);
  }
}

function shouldUseSsl(connectionString) {
  return Boolean(connectionString) && !/localhost|127\.0\.0\.1/i.test(connectionString);
}

function toCleanText(value) {
  return String(value ?? "").trim();
}

function buildWhereClauses(options, productId) {
  const params = [productId, options.movementType];
  const where = ["sm.product_id = $1::uuid", "sm.movement_type = $2"];

  if (options.branchCode) {
    params.push(options.branchCode);
    const placeholder = `$${params.length}`;
    if (options.movementType === "RECEIVE" || options.movementType === "TRANSFER_IN") {
      where.push(`to_l.code = ${placeholder}`);
    } else if (options.movementType === "DISPENSE" || options.movementType === "TRANSFER_OUT") {
      where.push(`from_l.code = ${placeholder}`);
    } else {
      where.push(`(from_l.code = ${placeholder} OR to_l.code = ${placeholder})`);
    }
  }

  if (options.dateFrom) {
    params.push(options.dateFrom);
    where.push(`COALESCE(sm.corrected_occurred_at, sm.occurred_at) >= $${params.length}::date`);
  }

  if (options.dateTo) {
    params.push(options.dateTo);
    where.push(`COALESCE(sm.corrected_occurred_at, sm.occurred_at) < ($${params.length}::date + interval '1 day')`);
  }

  return { params, where };
}

async function fetchExportData(options) {
  dotenv.config({ path: path.join(projectRoot, "server", ".env") });

  const connectionString = process.env.RX1011_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("RX1011_DATABASE_URL or DATABASE_URL is not set in server/.env");
  }

  const pool = new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
  });

  try {
    const productResult = await pool.query(
      `
        SELECT
          p.id::text AS id,
          p.product_code AS "productCode",
          p.trade_name AS "tradeName",
          p.generic_name AS "genericName",
          p.is_active AS "isActive",
          m.code AS "manufacturerCode",
          m.name AS "manufacturerName"
        FROM products p
        LEFT JOIN locations m ON m.id = p.manufacturer_location_id
        WHERE p.product_code = $1
        LIMIT 1
      `,
      [options.productCode]
    );

    const product = productResult.rows[0];
    if (!product) {
      throw new Error(`Product not found: ${options.productCode}`);
    }

    const unitsResult = await pool.query(
      `
        SELECT
          pul.id::text AS id,
          pul.code,
          pul.display_name AS "displayName",
          pul.is_base AS "isBase",
          pul.is_sellable AS "isSellable",
          pul.is_active AS "isActive",
          pul.sort_order AS "sortOrder",
          pul.barcode,
          pul.unit_key AS "unitKey"
        FROM product_unit_levels pul
        WHERE pul.product_id = $1::uuid
        ORDER BY
          COALESCE(pul.is_active, true) DESC,
          pul.is_sellable DESC,
          pul.is_base DESC,
          pul.sort_order ASC,
          pul.created_at ASC
      `,
      [product.id]
    );

    const barcode =
      unitsResult.rows.find((row) => toCleanText(row.barcode))?.barcode || "";

    const { params, where } = buildWhereClauses(options, product.id);
    const movementsResult = await pool.query(
      `
        SELECT
          sm.id::text AS id,
          sm.movement_type AS "movementType",
          COALESCE(sm.corrected_occurred_at, sm.occurred_at)::text AS "occurredAt",
          from_l.code AS "fromCode",
          from_l.name AS "fromName",
          to_l.code AS "toCode",
          to_l.name AS "toName",
          pl.lot_no AS "lotNo",
          pl.exp_date::text AS "expDate",
          ABS(sm.quantity::numeric)::text AS quantity,
          ABS(COALESCE(sm.quantity_base, sm.quantity)::numeric)::text AS "quantityBase",
          pul.display_name AS "unitLabel",
          pul.barcode AS "unitBarcode",
          sm.source_ref_type AS "sourceRefType"
        FROM stock_movements sm
        LEFT JOIN locations from_l ON from_l.id = sm.from_location_id
        LEFT JOIN locations to_l ON to_l.id = sm.to_location_id
        LEFT JOIN product_lots pl ON pl.id = sm.lot_id
        LEFT JOIN product_unit_levels pul ON pul.id = sm.unit_level_id
        WHERE ${where.join(" AND ")}
        ORDER BY COALESCE(sm.corrected_occurred_at, sm.occurred_at) ASC, sm.created_at ASC, sm.id ASC
      `,
      params
    );

    return {
      product,
      units: unitsResult.rows,
      barcode: toCleanText(barcode),
      movements: movementsResult.rows,
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.productCode) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  if (!["sequence", "prefixed", "blank"].includes(options.serialMode)) {
    throw new Error("--serial-mode must be sequence, prefixed, or blank");
  }
  if (!["gtin", "package-code"].includes(options.identifierType)) {
    throw new Error("--identifier-type must be gtin or package-code");
  }

  await fs.mkdir(options.outDir, { recursive: true });

  const exportData = await fetchExportData(options);
  const partnerMapping = await loadPartnerMapping(options.mappingJson);
  const safeProductCode = options.productCode.replace(/[^A-Za-z0-9_-]+/g, "_");
  const suffixParts = [
    safeProductCode,
    options.movementType.toLowerCase(),
    options.branchCode ? `branch-${options.branchCode}` : "all-branches",
    options.dateFrom || "all-dates",
    options.dateTo || "",
  ].filter(Boolean);
  const fileSuffix = suffixParts.join("_");

  const payload = {
    productCode: options.productCode,
    product: exportData.product,
    units: exportData.units,
    barcode: exportData.barcode,
    movements: exportData.movements,
    masterXlsx: path.resolve(options.masterXlsx),
    transactionTemplateXlsx: path.resolve(options.transactionTemplateXlsx),
    partnerMapping,
    outputMasterXlsx: path.join(options.outDir, `fda_track_trace_md_${fileSuffix}.xlsx`),
    outputTransactionXlsx: path.join(options.outDir, `transaction_sn_${fileSuffix}.xlsx`),
    outputReportJson: path.join(options.outDir, `match_report_${fileSuffix}.json`),
    movementType: options.movementType,
    branchCode: options.branchCode || null,
    dateFrom: options.dateFrom || null,
    dateTo: options.dateTo || null,
    serialMode: options.serialMode,
    identifierType: options.identifierType,
    partnerCode: options.partnerCode,
    identifier: options.identifier,
  };

  const payloadPath = path.join(options.outDir, `payload_${fileSuffix}.json`);
  await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), "utf8");

  const proc = spawnSync("python", ["-", payloadPath], {
    input: workbookWriterPython,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (proc.status !== 0) {
    throw new Error(proc.stderr || proc.stdout || "Failed to create FDA workbooks");
  }

  console.log(proc.stdout.trim());
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
