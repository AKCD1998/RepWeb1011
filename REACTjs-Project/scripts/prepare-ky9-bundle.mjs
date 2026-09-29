import fs from "node:fs/promises";
import path from "node:path";
import { reconcilePurchases, purchaseLotGapsCsv, purchaseRowsCsv } from "../src/lib/report1011/purchaseBulk.js";
import { encodeCsv } from "../src/lib/report1011/bulkValues.js";

const args = process.argv.slice(2);
const option = (key) => args.includes(key) ? args[args.indexOf(key) + 1] : "";
for (const key of ["--register", "--movements", "--out-dir"]) if (!option(key) || option(key).startsWith("--")) throw new Error(`Required argument ${key}`);
const readJson = async (file) => JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
const register = await readJson(option("--register"));
const movements = await readJson(option("--movements"));
const sources = [];
for (const row of register.source_records) {
  let facts = {};
  if (row.facts_file && path.basename(row.facts_file) === row.facts_file) {
    try { facts = await readJson(path.join(path.dirname(option("--register")), row.facts_file)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const webReceipt = facts.web_receipt;
  const productFacts = (facts.products || []).find((product) => row.slug && product.slug === row.slug) || {};
  sources.push({
    id: row.id, code: row.code, name: row.name, kind: row.kind, lot: row.lot,
    invoice_no: row.invoice_no, invoice_date: row.invoice_date,
    source_supplier: row.source_supplier || (typeof facts.supplier === "string" ? facts.supplier : ""),
    source_qty: row.source_qty, source_unit: row.source_unit, cap_qty: row.cap_qty, cap_unit: row.cap_unit,
    quantity_conversion_status: row.quantity_conversion_status, pack: row.pack,
    mfg: row.mfg ?? productFacts.mfg ?? null, exp: row.exp ?? productFacts.exp ?? null,
    source_file: row.source_file, source_sha256: row.source_sha256,
    receiptDocuments: webReceipt?.explicit_invoice_reference_verified === true ? [webReceipt.number] : [],
    receiptHints: webReceipt?.number && webReceipt.explicit_invoice_reference_verified !== true ? [webReceipt.number] : [],
    candidateCodes: productFacts.candidate_codes || [], mappingNote: productFacts.note || "",
  });
}
if (option("--extra-sources")) sources.push(...(await readJson(option("--extra-sources"))).source_records);
if (option("--source-updates")) {
  const updates = (await readJson(option("--source-updates"))).source_updates;
  if (!Array.isArray(updates)) throw new Error("source_updates must be an array");
  const fields = ["code", "name", "kind", "lot", "invoice_no", "invoice_date", "source_supplier", "source_qty", "source_unit", "cap_qty", "cap_unit", "quantity_conversion_status", "mfg", "exp", "mappingNote"];
  for (const update of updates) {
    const source = sources.find((row) => row.id === update.id);
    if (!source) throw new Error(`Unknown scan source ID ${update.id}`);
    for (const field of fields) if (Object.hasOwn(update, field)) source[field] = update[field];
    if (update.evidence_note) source.mappingNote = [source.mappingNote, update.evidence_note].filter(Boolean).join(" · ");
  }
}
const bundle = { version: 1, type: "ky9-bulk", preparedAt: new Date().toISOString(), sources: { source_records: sources }, movements,
  review: { edits: {}, receiptMatches: {}, transferMatches: {} } };
const result = reconcilePurchases({ sourceInput: bundle.sources, movementInput: movements });
const output = path.resolve(option("--out-dir"));
await fs.mkdir(output, { recursive: true });
const write = async (name, value) => fs.writeFile(path.join(output, name), value, { flag: args.includes("--replace-output") ? "w" : "wx" });
await write("ky9_bundle.json", JSON.stringify(bundle, null, 2));
await write("ky9_purchase_rows_review.csv", purchaseRowsCsv(result.rows));
await write("ky9_lot_gaps.csv", purchaseLotGapsCsv(result));
await write("ky9_source_coverage.csv", encodeCsv([["sourceId", "productCode", "name", "lot", "invoiceNo", "invoiceDate", "receiptDocuments", "status", "reviewNotes", "manufacturedDate", "expiryDate", "sourceFile"],
  ...result.sources.map((source) => { const jobs = result.receiptJobs.filter((job) => job.sourceId === source.id); return [source.id, source.code, source.name, source.lot, source.invoiceNo, source.invoiceDate,
    jobs.map((job) => job.doc).join("; "), jobs.length ? jobs.map((job) => job.status).join("; ") : "no_receipt_link", [...source.issues, ...jobs.flatMap((job) => job.issues)].join("; "), source.manufacturedDate, source.expiry, source.file]; })]));
const summary = { sourceRecords: sources.length, includedSources: result.sources.length, excludedNonMedicines: result.excluded.length,
  sourcesWithIssues: result.sourceIssues.length, sourcesWithoutReceiptLink: result.sources.filter((source) => !result.receiptJobs.some((job) => job.sourceId === source.id)).length,
  purchaseRows: result.rows.length, readyRows: result.rows.filter((row) => row.ready).length, reviewRows: result.rows.filter((row) => !row.ready).length,
  rowsWithLinkedLots: result.rows.filter((row) => row.lot).length, rowsWithoutLinkedLots: result.rows.filter((row) => !row.lot).length,
  exactDuplicatesRemoved: result.duplicates, mirroredTransferPairs: result.mirroredTransfers.length, importErrors: result.errors, branches: result.branches.map((branch) => ({ branch: branch.branch, rows: branch.rows.length, ready: branch.rows.filter((row) => row.ready).length })),
  note: "Development draft. Transfer dates/quantities are native records; lot proposals require review. POS allocation is not used as purchase evidence." };
await write("manifest.json", JSON.stringify(summary, null, 2));
await write("README_TH.md", `# ข้อมูลสำหรับ Bulk ขย.9\n\n1. เปิดหน้า Reports แล้วขยาย “Bulk ขย.9 · บัญชีซื้อยาหลายสาขา”\n2. นำเข้า ky9_bundle.json เพียงไฟล์เดียว\n3. ตรวจข้อมูลซื้อ/ประเภทสินค้า จับคู่ใบรับ และยืนยันล็อตของรายการโอนตามหลักฐาน\n4. เลือกช่วงวันที่และสาขา แล้วกด “สร้างเอกสารฉบับร่าง”\n5. กด “พิมพ์ / บันทึก PDF ทุกสาขาที่เลือก” และเลือก Save as PDF แนวนอน A4\n6. ดาวน์โหลด “บันทึกข้อมูลและการตรวจ” เพื่อเก็บการจับคู่ไว้ นำเข้าไฟล์นั้นทำต่อครั้งหน้าได้\n\nข้อมูลชุดนี้มี ${summary.purchaseRows} แถว เชื่อมล็อตจากใบสแกน ${summary.rowsWithLinkedLots} แถว และยังไม่เชื่อมล็อต ${summary.rowsWithoutLinkedLots} แถว การมีล็อตที่เสนอไม่ได้หมายความว่าผ่านการตรวจแล้ว\n\nPDF เริ่มต้นรวมเฉพาะแถวที่เชื่อมล็อต และแจ้งจำนวนที่ยังไม่รวมในท้ายหน้า หากต้องการฉบับร่างครบทุกแถว ให้เลือก “รวมรายการที่ยังไม่เชื่อมล็อตใน PDF” ก่อนสร้างเอกสาร แถวเหล่านั้นจะระบุ “รอเชื่อมล็อต”\n\nky9_purchase_rows_review.csv เก็บข้อมูลรับ/โอนทั้งหมด ส่วน ky9_lot_gaps.csv ใช้ค้นใบรับและเลขใบกำกับเพิ่มเติม เลขใบรับที่อยู่ใกล้วันโอนยังไม่ได้ยืนยันว่าเป็นล็อตของการโอนนั้น\n\nรายการที่ยังไม่ยืนยันจะพิมพ์คำว่า “รอตรวจ” ในหมายเหตุ ลายมือชื่อเว้นไว้ให้ผู้มีหน้าที่ปฏิบัติการ ระบบไม่สร้างชื่อหรือการซื้อจากยอดขาย\n\nCSV และ PDF ในชุดนี้เป็นฉบับสำหรับพัฒนาและตรวจสอบ ไม่ใช่เอกสารที่ส่งราชการแล้ว\n`);
console.log(JSON.stringify(summary));
