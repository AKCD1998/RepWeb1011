import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? "" : args[index + 1] || "";
};
const oldFile = option("--old");
const salesFile = option("--sales");
const outDir = option("--out-dir");
if (!oldFile || !salesFile || !outDir) {
  throw new Error("Usage: node scripts/build-ky11-oct24-source-snapshot.mjs --old <old combined CSV> --sales <new POS CSV> --out-dir <new output directory>");
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const oldBytes = await fs.readFile(oldFile);
const newBytes = await fs.readFile(salesFile);
const oldHash = sha256(oldBytes);
if (oldHash !== "6a59c4d353e7e50ea3c2e9115ca7684763ce55f19ec58598743c4c70a3d5f366") {
  throw new Error("The historical snapshot source differs from the saved web version");
}
const decode = (bytes) => bytes.toString("utf8").replace(/^\uFEFF/, "");
const oldRows = parse(decode(oldBytes), { columns: true, skip_empty_lines: true });
const newRows = parse(decode(newBytes), { columns: true, skip_empty_lines: true });
const oldHeader = Object.keys(oldRows[0] || {});
const required = ["recordType", "branchCode", "productCode", "saleDate", "quantity", "billNo", "batch", "received_date", "boxes", "units_per_box"];
if (required.some((name) => !oldHeader.includes(name))) throw new Error("Old combined CSV has an unexpected schema");
if (oldRows.length !== 3306 || oldRows.filter((row) => row.recordType === "SALE").length !== 3209 ||
    oldRows.filter((row) => row.recordType === "LOT").length !== 97) throw new Error("Old combined CSV has unexpected row counts");
if (newRows.length !== 640) throw new Error("New POS CSV must contain exactly 640 reviewed sale rows");
const expectedCodes = new Set(oldRows.filter((row) => row.recordType === "SALE").map((row) => row.productCode));
if (expectedCodes.size !== 27) throw new Error("The saved historical scope must contain 27 products");
const seenBills = new Set(oldRows.filter((row) => row.recordType === "SALE" && row.billNo)
  .map((row) => `${row.branchCode}:${row.productCode}:${row.billNo}`));
const requiredNew = ["branchCode", "productCode", "saleDate", "saleTime", "quantity", "billNo", "unit", "quantityBasis", "sourceNativeFile"];
if (requiredNew.some((name) => !Object.hasOwn(newRows[0], name))) throw new Error("New POS CSV has an unexpected schema");
const appended = newRows.map((row, index) => {
  const location = `New POS row ${index + 2}`;
  if (!expectedCodes.has(row.productCode)) throw new Error(`${location}: product is outside the saved 27-product scope`);
  if (!["001", "003", "004", "005"].includes(row.branchCode)) throw new Error(`${location}: unexpected branch`);
  if (row.saleDate < "2026-09-28" || row.saleDate > "2026-10-24") throw new Error(`${location}: sale outside the continuation period`);
  if (!/^\d+$/.test(row.quantity) || Number(row.quantity) <= 0) throw new Error(`${location}: quantity is not a positive integer`);
  if (!row.billNo) throw new Error(`${location}: bill number is missing`);
  const billKey = `${row.branchCode}:${row.productCode}:${row.billNo}`;
  if (seenBills.has(billKey)) throw new Error(`${location}: duplicate branch/product/bill`);
  seenBills.add(billKey);
  return {
    ...row,
    recordType: "SALE",
    inputPurpose: "DEVELOPMENT_INPUT_ONLY",
  };
});
const allRows = [...oldRows, ...appended];
const escape = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const outputText = "\uFEFF" + [oldHeader, ...allRows.map((row) => oldHeader.map((name) => row[name] ?? ""))]
  .map((row) => row.map(escape).join(",")).join("\n");
const filename = "KY11_Source_27_Products_20260618-20261024_DRAFT_UNVERIFIED_v1.csv";
const manifest = {
  snapshotKey: "stockday-pos-20260618-20261024-dev-v1",
  periodStart: "2026-06-18",
  periodEnd: "2026-10-24",
  sourceStatus: "DEVELOPMENT_REFERENCE",
  reviewStatus: "DRAFT_UNVERIFIED",
  sourceFilename: filename,
  sourceSha256: sha256(Buffer.from(outputText, "utf8")),
  originalSourceSha256: oldHash,
  continuationSourceSha256: sha256(newBytes),
  salesRowCount: 3849,
  lotRowCount: 97,
  confirmedPaperLotCount: 19,
  simulatedLotCount: 78,
  newSalesRowCount: appended.length,
  productCount: expectedCodes.size,
  branchCodes: ["001", "003", "004", "005"],
  caveats: [
    "The 78 simulated lot rows are development references, not verified branch receipts.",
    "The 19 paper-confirmed lot rows use a document header date, not item-level receipt dates.",
    "The October 24 POS capture was taken during the day; it is not a full-day close.",
    "No branch/lot closing balances or complete October receipt and transfer evidence are included.",
    "This snapshot freezes inputs only. It contains no generated buyers, lot allocations, approved KY11 document or PDF.",
  ],
};
if (allRows.length !== manifest.salesRowCount + manifest.lotRowCount) throw new Error("Output row count mismatch");
await fs.mkdir(outDir, { recursive: false });
await fs.writeFile(path.join(outDir, filename), outputText, { flag: "wx" });
await fs.writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ output: path.join(outDir, filename), ...manifest }));
