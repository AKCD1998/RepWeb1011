import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

const args = process.argv.slice(2);
const option = (key) => args[args.indexOf(key) + 1];
for (const key of ["--env-file", "--register", "--out-file", "--date-from", "--date-to"]) {
  if (!args.includes(key) || !option(key) || option(key).startsWith("--")) throw new Error(`Required argument ${key}`);
}
const register = JSON.parse((await fs.readFile(option("--register"), "utf8")).replace(/^\uFEFF/, ""));
const candidateCodes = [];
for (const file of new Set(register.source_records.map((row) => row.facts_file).filter(Boolean))) {
  if (path.basename(file) !== file) continue;
  try {
    const facts = JSON.parse((await fs.readFile(path.join(path.dirname(option("--register")), file), "utf8")).replace(/^\uFEFF/, ""));
    for (const product of facts.products || []) for (const candidate of product.candidate_codes || []) if (candidate.code) candidateCodes.push(candidate.code);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const extraCodes = args.includes("--extra-sources") ? JSON.parse((await fs.readFile(option("--extra-sources"), "utf8")).replace(/^\uFEFF/, "")).source_records.map((row) => row.code).filter(Boolean) : [];
const updatedCodes = args.includes("--source-updates") ? JSON.parse((await fs.readFile(option("--source-updates"), "utf8")).replace(/^\uFEFF/, "")).source_updates.map((row) => row.code).filter(Boolean) : [];
const codes = [...new Set([...register.source_records.map((row) => row.code).filter(Boolean), ...candidateCodes, ...extraCodes, ...updatedCodes, "IC-000663"])];
const dateFrom = option("--date-from"), dateTo = option("--date-to");
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateFrom > dateTo) throw new Error("Invalid date range");
const env = dotenv.parse(await fs.readFile(option("--env-file"), "utf8"));
if (!env.DATABASE_URL) throw new Error("The selected environment has no DATABASE_URL");
const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '45s'");
  const receipts = await client.query(`
    SELECT 'supplier_receipt' AS type,
      concat_ws('|', l.source_table, h.branch_code, h.doc_type, l.doc_no, l.seq_no, l.product_code) AS "eventId",
      h.doc_date::text AS date, h.doc_time AS time, l.doc_no AS "documentNo",
      l.seq_no AS "lineNo", h.source_table AS "sourceTable", h.doc_type AS "documentType",
      h.branch_code AS "branchTo", h.supplier_name AS "supplierName", h.supplier_code AS "supplierCode",
      h.ref_ext AS "invoiceReference", h.ref_ext_date::text AS "invoiceReferenceDate",
      h.sta_doc AS "documentStatus", h.sta_prc_doc AS "processStatus",
      l.product_code AS "productCode", l.product_name AS "productName", l.barcode,
      l.qty::float8 AS "originalQuantity", l.unit_name AS "originalUnit", l.unit_code AS "unitCode",
      COALESCE(l.qty_base, l.qty * COALESCE(l.stock_factor, 1))::float8 AS "baseQuantity",
      l.stock_factor::float8 AS "stockFactor", l.lot_no AS lot, l.expired_date::text AS expiry,
      l.set_price::float8 AS "unitPrice", l.net::float8 AS "lineAmount"
    FROM ada.approved_receipt_lines l JOIN ada.approved_receipt_headers h ON h.doc_no=l.doc_no
    WHERE l.product_code=ANY($1::text[]) AND h.doc_date BETWEEN $2::date AND $3::date
      AND h.branch_code=ANY($4::text[])
    ORDER BY h.doc_date, l.doc_no, l.seq_no`, [codes, dateFrom, dateTo, ["000", "001", "003", "004", "005"]]);
  const transfers = await client.query(`
    SELECT 'transfer' AS type,
      concat_ws('|', l.source_table, l.doc_type, l.branch_code, l.doc_no, l.line_no, l.product_code) AS "eventId",
      l.ada_transfer_line_id::text AS "nativeLineId", h.doc_date::text AS date, h.doc_time AS time,
      l.doc_no AS "documentNo", l.line_no AS "lineNo", h.source_table AS "sourceTable",
      h.doc_type AS "documentType", h.doc_status AS "documentStatus", h.process_status AS "processStatus",
      h.branch_code AS "branchFrom", h.branch_code_to AS "branchTo",
      h.reference_doc_no AS "headerReference", l.reference_doc_no AS "lineReference",
      l.reference_line_no AS "referenceLineNo", h.remark AS remark,
      l.product_code AS "productCode", l.barcode, l.qty::float8 AS "originalQuantity",
      l.unit_name AS "originalUnit", l.unit_code AS "unitCode",
      COALESCE(l.qty_base, l.qty * COALESCE(l.stock_factor, 1))::float8 AS "baseQuantity",
      l.stock_factor::float8 AS "stockFactor", l.lot_no AS lot, l.expiry_date::text AS expiry
    FROM ada.transfer_lines l JOIN ada.transfer_headers h
      ON h.doc_no=l.doc_no AND h.branch_code=l.branch_code AND h.doc_type=l.doc_type
    WHERE l.product_code=ANY($1::text[]) AND h.doc_date BETWEEN $2::date AND $3::date
      AND (h.branch_code=ANY($4::text[]) OR h.branch_code_to=ANY($4::text[]))
    ORDER BY h.doc_date, l.doc_no, l.line_no`, [codes, dateFrom, dateTo, ["000", "001", "003", "004", "005"]]);
  const productColumns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='ada' AND table_name='products'");
  const allowed = ["product_code", "product_name", "product_name_th", "unit_small", "unit_name", "unit_code", "stock_factor"];
  const fields = allowed.filter((field) => productColumns.rows.some((row) => row.column_name === field));
  const products = await client.query(`SELECT ${fields.join(",")} FROM ada.products WHERE product_code=ANY($1::text[])`, [codes]);
  await client.query("ROLLBACK");
  const result = { version: 1, capturedAt: new Date().toISOString(), source: "StockDay Movement Trace / canonical ada receipt and transfer tables", dateFrom, dateTo,
    readOnlyTransaction: true, productCodes: codes, products: products.rows, receipts: receipts.rows, transfers: transfers.rows };
  await fs.mkdir(path.dirname(path.resolve(option("--out-file"))), { recursive: true });
  await fs.writeFile(option("--out-file"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ receiptLines: receipts.rows.length, transferLines: transfers.rows.length, products: products.rows.length, readOnlyTransaction: true }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(JSON.stringify({ errorCode: error.code || error.name, message: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, "[connection redacted]") }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
