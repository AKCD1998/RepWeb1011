import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (!args.includes("--source-dir") || !args.includes("--out-dir")) {
  console.error("Usage: node scripts/prepare-manual-bulk-inputs.mjs --source-dir <All_Branches_PDF> --out-dir <new development folder>");
  process.exit(1);
}
const sourceDir = path.resolve(option("--source-dir"));
const outDir = path.resolve(option("--out-dir"));
if (sourceDir === outDir || outDir.startsWith(sourceDir + path.sep)) throw new Error("Choose a new sibling output folder; preserve the supplied source folder.");
await fs.mkdir(outDir, { recursive: true });
const json = async (name) => JSON.parse((await fs.readFile(path.join(sourceDir, name), "utf8")).replace(/^\uFEFF/, ""));
const [register, assignments] = await Promise.all([
  json("LOT_REGISTER_LOT_INFERENCE_20260929_V2.json"),
  json("POS_LOT_ASSIGNMENTS_LOT_INFERENCE_20260929_V2.json"),
]);
const targets = new Map(register.source_records.filter((record) => record.report_group_prior_review === "KY11" && record.code)
  .map((record) => [record.code, record]));
const sales = [];
const audit = [];
for (const row of assignments.rows) {
  if (!targets.has(row.code)) continue;
  if (!Number.isSafeInteger(row.qty_original) || row.qty_original <= 0) { audit.push(row); continue; }
  // Retain the entire original bill, including quantities outside inferred lots.
  // Patient identities and inferred allocations are deliberately not input fields.
  sales.push([row.branch, row.code, row.at_local, row.qty_original, row.bill, row.raw_unit]);
}

// The initial Iyafin CSVs were generated for the legacy detector, with one
// explicitly duplicated first data row. Remove that known padding, not real bills.
const initialCounts = { "001": 5, "003": 2, "004": 1, "005": 1 };
for (const [branch, expected] of Object.entries(initialCounts)) {
  const text = await fs.readFile(path.join(sourceDir, "..", "source_inputs", `sales_branch_${branch}.csv`), "utf8");
  const rows = parse(text, { bom: true, skip_empty_lines: true });
  const data = rows.slice(1);
  if (JSON.stringify(data[0]) !== JSON.stringify(data[1])) throw new Error(`Legacy Iyafin branch ${branch}: expected documented detection padding.`);
  const actual = data.slice(1);
  if (actual.reduce((sum, row) => sum + Number(row[1]), 0) !== expected) throw new Error(`Iyafin ${branch}: source total differs from README.`);
  for (const [date, qty] of actual) sales.push([branch, "IC-000663", date, Number(qty), "", "ขวด"]);
}
sales.sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]) || left[2].localeCompare(right[2]));
const groups = new Map();
for (const row of sales) {
  const groupKey = `${row[0]}:${row[1]}`;
  if (!groups.has(groupKey)) groups.set(groupKey, { branch: row[0], code: row[1], rows: 0, quantity: 0 });
  groups.get(groupKey).rows += 1;
  groups.get(groupKey).quantity += row[3];
}
const csv = (rows) => "\uFEFF" + rows.map((row) => row.map((value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}).join(",")).join("\n");
const manifest = {
  purpose: "development_input_only", source_dir: sourceDir,
  sales_rows: sales.length, product_count: new Set(sales.map((row) => row[1])).size,
  branch_count: new Set(sales.map((row) => row[0])).size, job_count: groups.size,
  sales_quantity: sales.reduce((sum, row) => sum + row[3], 0),
  audit_nonpositive_or_fractional_rows: audit.length,
  groups: [...groups.values()], patient_identity_in_input: false,
  branch_receipts_autofilled: false,
  notes: ["Classifications come from the supplied source register; the app validates against its own KY11 catalog.",
    "Includes original positive bill quantities, including portions outside inferred source lots.",
    "Invoice/source capacities are reference data and are not verified branch receipts.",
    "Complete branch_lots_to_complete.csv using actual branch receipts before generating reports.",
    "Three nonpositive sales rows remain in audit_rows.csv for review; no returns were silently netted.",
    "Initial Iyafin legacy CSV detection padding removed; nine original sold bottles retained."]
};
// Exclusive writes keep repeated execution from overwriting a reviewed input set.
const write = (name, text) => fs.writeFile(path.join(outDir, name), text, { flag: "wx" });
await write("bulk_ky11_sales.csv", csv([["branchCode", "productCode", "saleDate", "quantity", "billNo", "unit"], ...sales]));
await write("branch_lots_to_complete.csv", csv([["branchCode", "productCode", "batch", "received_date", "boxes", "units_per_box"], ...[...groups.values()].map((group) => [group.branch, group.code, "", "", "", ""])]));
await write("source_lots_reference.csv", csv([["productCode", "productName", "batch", "invoice_date", "source_quantity", "source_unit", "base_capacity", "base_unit", "source_file"],
  ...register.source_records.filter((record) => targets.has(record.code)).map((record) => [record.code, record.name, record.lot, record.invoice_date, record.source_qty, record.source_unit, record.cap_qty, record.cap_unit, record.source_file])]));
await write("audit_rows.csv", csv([["branchCode", "productCode", "saleDate", "quantity", "billNo", "unit", "status"], ...audit.map((row) => [row.branch, row.code, row.at_local, row.qty_original, row.bill, row.raw_unit, row.status])]));
await write("manifest.json", JSON.stringify(manifest, null, 2));
await write("README_TH.md", `# ชุดข้อมูลพัฒนา Bulk ขย.11\n\nอ้างอิงข้อมูลที่ผู้ใช้ให้เพื่อพัฒนาระบบ\n\n- ประวัติขาย: ${manifest.sales_rows} แถว / ${manifest.product_count} สินค้า / ${manifest.branch_count} สาขา / ${manifest.job_count} งาน\n- อัปโหลด bulk_ky11_sales.csv ในโหมด Bulk ขย.11\n- เติม branch_lots_to_complete.csv ด้วยลอตและจำนวนรับจริงของแต่ละสาขา แล้วอัปโหลดพร้อมกัน หรือกรอกลอตในหน้าเว็บ\n- source_lots_reference.csv ใช้ตรวจลอตจากใบกำกับ ไม่ใช่จำนวนรับของแต่ละสาขา\n- audit_rows.csv เก็บรายการคืน/จำนวนไม่เป็นบวก ${audit.length} แถวสำหรับตรวจ\n- ใช้ประวัติขายต้นฉบับเต็มจำนวน ไม่ตัดเหลือเฉพาะยอดที่ไฟล์เดิมอนุมานล็อตได้\n- ไฟล์นี้ไม่มีชื่อหรือเลขบัตรผู้ป่วย ระบบสร้างรายงานจะเรียกการจัดสรรเดิมของเว็บไซต์\n`);
console.log(JSON.stringify({ outDir, ...Object.fromEntries(["sales_rows", "product_count", "branch_count", "job_count", "sales_quantity", "audit_nonpositive_or_fractional_rows"].map((field) => [field, manifest[field]])) }, null, 2));
