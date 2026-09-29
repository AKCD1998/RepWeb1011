import { describe, expect, test } from "@jest/globals";
import { formatPurchaseQuantity, normalizePurchaseSources, purchaseLotGapsCsv, purchaseRowsCsv, reconcilePurchases, selectPurchaseDocumentRows } from "../../src/lib/report1011/purchaseBulk.js";

const source = (changes = {}) => ({ id: "s1", code: "IC-001", name: "ยาทดสอบ", kind: "drug", lot: "LOT-A", invoice_no: "INV-1", invoice_date: "2026-06-16", source_supplier: "ผู้ขาย", source_qty: 36, source_unit: "ขวด", cap_qty: 36, cap_unit: "ขวด", quantity_conversion_status: "EXPLICIT_PRIOR_FACTS", ...changes });
const receipt = (changes = {}) => ({ type: "supplier_receipt", eventId: "PR|1|IC-001", date: "2026-06-18", documentNo: "PR1", productCode: "IC-001", branchTo: "000", supplierName: "ผู้ขายจริง", invoiceReference: "INV-1", originalQuantity: 30, originalUnit: "ขวด", baseQuantity: 30, stockFactor: 1, lot: "1", unitPrice: 10, lineAmount: 300, ...changes });
const free = () => receipt({ eventId: "PR|2|IC-001", originalQuantity: 6, baseQuantity: 6, unitPrice: 0, lineAmount: 0 });
const transfer = (changes = {}) => ({ type: "transfer", eventId: "TB|1|IC-001", date: "2026-06-18", documentNo: "TB1", productCode: "IC-001", branchFrom: "000", branchTo: "001", originalQuantity: 13, originalUnit: "ขวด", baseQuantity: 13, stockFactor: 1, ...changes });
const run = (changes = {}) => reconcilePurchases({ sourceInput: { source_records: [source()] }, movementInput: { receipts: [receipt(), free()], transfers: [transfer()], dateFrom: "2026-05-01", dateTo: "2026-09-28" }, ...changes });

describe("bulk purchase evidence", () => {
  const mirror = (documentType, changes = {}) => transfer({ eventId: `TS-${documentType}`, documentNo: "TS00126-000001", sourceTable: "TCNTPdtTnfHD", documentType, lineNo: 1, ...changes });
  test("Ada type 7 and 8 are one physical transfer, retaining the receiving date and native IDs", () => {
    const result = run({ movementInput: { receipts: [receipt(), free()], transfers: [mirror("8"), mirror("7", { date: "2026-06-19" })] } });
    const rows = result.rows.filter((row) => row.type === "transfer");
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ id: "TS-7", date: "2026-06-19", qty: 13, pairedEventIds: ["TS-8"] });
    expect(result.mirroredTransfers).toHaveLength(1);
  });
  test("distinct native line numbers remain distinct transfers even with equal quantities", () => {
    const transfers = [mirror("7"), mirror("8"), mirror("7", { eventId: "TS-7b", lineNo: 2 }), mirror("8", { eventId: "TS-8b", lineNo: 2 })];
    const result = run({ movementInput: { receipts: [receipt(), free()], transfers } });
    expect(result.rows.filter((row) => row.type === "transfer").map((row) => row.qty)).toEqual([13, 13]);
  });
  test("conflicting mirrored quantities block output instead of accepting two receipts", () => {
    const result = run({ movementInput: { receipts: [receipt(), free()], transfers: [mirror("7"), mirror("8", { originalQuantity: 12, baseQuantity: 12 })] } });
    expect(result.errors).toHaveLength(1); expect(result.rows.every((row) => !row.ready)).toBe(true);
  });
  test("saved confirmation on a paired dispatch survives reconciliation to the receipt ID", () => {
    const result = run({ movementInput: { receipts: [receipt(), free()], transfers: [mirror("7"), mirror("8")] }, transferMatches: { "TS-8": "s1" } });
    expect(result.rows.find((row) => row.type === "transfer")).toMatchObject({ sourceId: "s1", ready: true });
  });
  test("a dispatch-only entry remains a draft until receiving evidence is available", () => {
    const result = run({ movementInput: { receipts: [receipt(), free()], transfers: [mirror("8")] }, transferMatches: { "TS-8": "s1" } });
    expect(result.rows.find((row) => row.type === "transfer").ready).toBe(false);
    expect(result.rows.find((row) => row.type === "transfer").issues.join(" ")).toContain("เฉพาะฝั่งจ่ายโอน");
  });
  test("preserves paid and free native receipt lines and scanned lot instead of placeholder", () => {
    const result = run();
    const hq = result.rows.filter((row) => row.branch === "000");
    expect(hq.map((row) => row.qty)).toEqual([30, 6]);
    expect(hq.map((row) => row.lot)).toEqual(["LOT-A", "LOT-A"]);
    expect(hq.every((row) => row.ready === true)).toBe(true);
    expect(hq[1].freeGoods).toBe(true);
    expect(result.rows.find((row) => row.branch === "001").status).toBe("proposed");
  });
  test("scanned manufacturing and expiry dates follow the selected lot into branch rows and CSV", () => {
    const result = run({ sourceInput: { source_records: [source({ mfg: "2026-01-21", exp: "2029-01-21" })] },
      movementInput: { receipts: [receipt({ expiry: "2046-06-18" }), free()], transfers: [transfer()] },
      transferMatches: { "TB|1|IC-001": "s1" } });
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) expect(row).toMatchObject({ lot: "LOT-A", manufacturedDate: "2026-01-21", expiry: "2029-01-21" });
    expect(purchaseRowsCsv(result.rows)).toContain("manufacturedDate,expiryDate");
    expect(purchaseRowsCsv(result.rows)).not.toContain("2046-06-18");
  });
  test("dates absent from a scan remain blank despite a native expiry value", () => {
    const result = run({ movementInput: { receipts: [receipt({ expiry: "2046-06-18" }), free()], transfers: [] } });
    expect(result.rows.every((row) => row.manufacturedDate === "" && row.expiry === "")).toBe(true);
  });
  test("unknown transfer lot remains a proposal until an explicit source ID is confirmed", () => {
    const before = run().rows.find((row) => row.branch === "001");
    expect(before.ready).toBe(false);
    const after = run({ transferMatches: { "TB|1|IC-001": "s1" } }).rows.find((row) => row.branch === "001");
    expect(after.status).toBe("manual"); expect(after.ready).toBe(true);
  });
  test("same-day dispatch yields all four actual branch receipts without using sales", () => {
    const transfers = [["001", 13], ["003", 13], ["004", 5], ["005", 5]].map(([branchTo, qty]) => transfer({ branchTo, eventId: `TB-${branchTo}`, documentNo: `TB-${branchTo}`, originalQuantity: qty, baseQuantity: qty }));
    const result = run({ movementInput: { receipts: [receipt(), free()], transfers } });
    expect(result.branches.map((branch) => [branch.branch, branch.rows.reduce((sum, row) => sum + row.qty, 0)])).toEqual([["000", 36], ["001", 13], ["003", 13], ["004", 5], ["005", 5]]);
  });
  test("identical native events deduplicate; conflicting quantities block ready output", () => {
    const identical = run({ movementInput: { receipts: [receipt(), receipt(), free()], transfers: [] } });
    expect(identical.duplicates).toBe(1); expect(identical.rows).toHaveLength(2);
    const conflict = run({ movementInput: { receipts: [receipt(), receipt({ originalQuantity: 31 }), free()], transfers: [] } });
    expect(conflict.errors).toHaveLength(1); expect(conflict.rows.every((row) => !row.ready)).toBe(true);
  });
  test("date/quantity match and unverified receipt hint require review", () => {
    const input = { source_records: [source({ invoice_no: "", receiptHints: ["PR1"] })] };
    const before = run({ sourceInput: input });
    expect(before.receiptJobs[0].status).toBe("proposed");
    const after = run({ sourceInput: input, receiptMatches: { "000|PR1|IC-001": "s1" } });
    expect(after.rows.filter((row) => row.type === "supplier_receipt").every((row) => row.ready)).toBe(true);
  });
  test("confirmed downstream transfer still carries an unverified upstream warning", () => {
    const result = run({ sourceInput: { source_records: [source({ invoice_no: "" })] }, transferMatches: { "TB|1|IC-001": "s1" } });
    expect(result.rows.find((row) => row.branch === "001").ready).toBe(false);
  });
  test("clearing a mapping preserves the user's decision instead of reapplying an automatic proposal", () => {
    const receiptCleared = run({ receiptMatches: { "000|PR1|IC-001": "" } });
    expect(receiptCleared.receiptJobs[0].sourceId).toBe("");
    const transferCleared = run({ transferMatches: { "TB|1|IC-001": "" } });
    expect(transferCleared.rows.find((row) => row.branch === "001").sourceId).toBe("");
  });
  test("does not assign branch receipts from old POS allocation fields", () => {
    const result = run({ sourceInput: { source_records: [source({ assigned_qty: 900, assigned_bill_rows: 80, branch_allocations: { "005": 900 } })] }, movementInput: { receipts: [], transfers: [] } });
    expect(result.rows).toEqual([]);
  });
  test("keeps the known medicine name on a draft transfer while its lot is unresolved", () => {
    const result = run({ movementInput: { receipts: [], transfers: [transfer()] } });
    expect(result.rows[0]).toMatchObject({ productName: "ยาทดสอบ", lot: "", status: "pending", ready: false });
  });
  test("preserves boxes on printed rows while base units validate the source capacity", () => {
    const result = run({ sourceInput: { source_records: [source({ source_qty: 2, source_unit: "กล่อง", cap_qty: 100, cap_unit: "แผง" })] }, movementInput: { receipts: [receipt({ originalQuantity: 2, originalUnit: "กล่อง", baseQuantity: 100, stockFactor: 50 })], transfers: [] } });
    expect(result.rows[0]).toMatchObject({ qty: 2, unit: "กล่อง", baseQty: 100, ready: true });
    expect(formatPurchaseQuantity(result.rows[0])).toBe("2 กล่อง");
  });
  test.each([[1, 50, "แผง", "50 แผง"], [7, 10, "แผง", "70 แผง"], [6, 20, "ซอง", "120 ซอง"], [20, 20, "ซอง", "400 ซอง"]])("counted packs print their total physical quantity (%s packs of %s)", (qty, count, unit, expected) => {
    const native = receipt({ originalQuantity: qty, originalUnit: `${count} ชิ้น`, baseQuantity: qty * count, stockFactor: 1 });
    const before = JSON.stringify(native);
    const result = run({ sourceInput: { source_records: [source({ source_qty: qty, source_unit: "กล่อง", cap_qty: qty * count, cap_unit: unit })] }, movementInput: { receipts: [native], transfers: [] } });
    expect(formatPurchaseQuantity(result.rows[0])).toBe(expected);
    expect(result.rows[0]).toMatchObject({ qty, unit: `${count} ชิ้น`, baseQty: qty * count });
    expect(JSON.stringify(native)).toBe(before);
    expect(purchaseRowsCsv(result.rows)).toContain(`,${qty},${count} ชิ้น,`);
    expect(purchaseRowsCsv(result.rows)).toContain(expected);
  });
  test("Neobun counted packs use the native sachet unit rather than a large-box source label", () => {
    const result = run({ sourceInput: { source_records: [source({ source_qty: 30, source_unit: "กล่อง", cap_qty: 30, cap_unit: "กล่อง", quantity_conversion_status: "SOURCE_UNIT_ONLY", pack: "20x10 แผ่น/กล่อง; ขาย 10 แผ่น/ซอง" })] },
      movementInput: { receipts: [receipt({ originalQuantity: 30, originalUnit: "20 ชิ้น", baseQuantity: 600, stockFactor: 1 })], transfers: [transfer({ eventId: "packed", originalQuantity: 6, originalUnit: "20 ชิ้น", baseQuantity: 120, stockFactor: 20 }), transfer({ eventId: "sachets", originalQuantity: 10, originalUnit: "ซอง", baseQuantity: 10 })] } });
    expect(formatPurchaseQuantity(result.rows.find((row) => row.id === "packed"))).toBe("120 ซอง");
  });
  test("a scan's explicit pack description supplies sachets when no single-unit native entry exists", () => {
    const result = run({ sourceInput: { source_records: [source({ source_qty: 40, source_unit: "กล่อง", cap_qty: 40, cap_unit: "กล่อง", quantity_conversion_status: "SOURCE_UNIT_ONLY", pack: "25 ซอง x 1 g ต่อกล่อง" })] },
      movementInput: { receipts: [receipt({ originalQuantity: 40, originalUnit: "25 ชิ้น", baseQuantity: 1000 })], transfers: [] } });
    expect(formatPurchaseQuantity(result.rows[0])).toBe("1,000 ซอง");
  });
  test("an unresolved lot still prints a product's known physical quantity", () => {
    const result = run({ sourceInput: { source_records: [source({ cap_unit: "แผง" })] }, movementInput: { receipts: [], transfers: [transfer({ originalQuantity: 7, originalUnit: "10 ชิ้น", baseQuantity: 70 })] } });
    expect(result.rows[0]).toMatchObject({ lot: "", sourceId: "", ready: false });
    expect(formatPurchaseQuantity(result.rows[0])).toBe("70 แผง");
  });
  test("conflicting native units and inconsistent quantities cannot silently assert a physical unit", () => {
    const result = run({ movementInput: { receipts: [], transfers: [transfer({ eventId: "strip", originalQuantity: 1, originalUnit: "แผง", baseQuantity: 1 }), transfer({ eventId: "sachet", originalQuantity: 1, originalUnit: "ซอง", baseQuantity: 1 }), transfer({ eventId: "packed", originalQuantity: 1, originalUnit: "50 ชิ้น", baseQuantity: 50 })] } });
    const row = result.rows.find((entry) => entry.id === "packed");
    expect(row.quantityUnit).toBe("");
    expect(formatPurchaseQuantity(row)).toBe("50 ชิ้น");
    expect(formatPurchaseQuantity({ ...row, baseQty: 60 })).toBe("1 × 50 ชิ้น (รอตรวจหน่วย)");
  });
  test("ambiguous lots and insufficient linked quantities remain visible", () => {
    const result = run({ sourceInput: { source_records: [source(), source({ id: "s2", lot: "LOT-B" })] } });
    expect(result.receiptJobs[0].status).toBe("pending");
    const insufficient = run({ movementInput: { receipts: [receipt(), free()], transfers: [transfer({ originalQuantity: 40, baseQuantity: 40 })] }, transferMatches: { "TB|1|IC-001": "s1" } });
    expect(insufficient.rows.find((row) => row.branch === "001").issues.join(" ")).toContain("ไม่ครอบคลุม");
  });
  test("purchase before invoice and duplicate source mapping need review", () => {
    const before = run({ sourceInput: { source_records: [source({ invoice_date: "2026-06-20" })] } });
    expect(before.rows[0].issues.join(" ")).toContain("ก่อนวันที่");
    const repeated = run({ movementInput: { receipts: [receipt(), free(), receipt({ eventId: "PR2|1", documentNo: "PR2" }), free()], transfers: [] } });
    expect(repeated.receiptJobs.every((job) => job.issues.some((issue) => issue.includes("มากกว่าหนึ่งใบ")))).toBe(true);
  });
  test("classifies non-medicines separately and exposes missing codes and uncertain classes", () => {
    const result = normalizePurchaseSources({ source_records: [source(), source({ id: "n", kind: "non_drug" }), source({ id: "u", code: "", kind: "type_pending" })] });
    expect(result.excluded).toHaveLength(1); expect(result.issues).toHaveLength(1);
    expect(result.issues[0].messages).toHaveLength(2);
  });
  test("inclusive period export retains original document and review notes", () => {
    const result = run({ dateFrom: "2026-06-18", dateTo: "2026-06-18" });
    expect(result.rows).toHaveLength(3);
    expect(run({ dateFrom: "2026-06-19" }).rows).toEqual([]);
    expect(purchaseRowsCsv(result.rows)).toContain("PR1");
    expect(purchaseRowsCsv(result.rows)).toContain("ใบโอนไม่ระบุล็อต");
  });
  test("default documents hold unlinked rows while complete CSV and explicit draft inclusion retain them", () => {
    const result = run({ movementInput: { receipts: [], transfers: [transfer()] } });
    expect(selectPurchaseDocumentRows(result.rows)).toEqual([]);
    expect(selectPurchaseDocumentRows(result.rows, { includeUnlinkedLots: true })).toHaveLength(1);
    expect(selectPurchaseDocumentRows(result.rows, { readyOnly: true, includeUnlinkedLots: true })).toEqual([]);
    expect(purchaseRowsCsv(result.rows)).toContain("TB1");
    expect(selectPurchaseDocumentRows(run().rows)).toHaveLength(3);
  });
  test("a later purchase with a different invoice is exposed for lookup without reusing an exhausted scanned lot", () => {
    const transfers = [transfer({ originalQuantity: 36, baseQuantity: 36 }), transfer({ eventId: "TB2|1", documentNo: "TB2", date: "2026-07-01", originalQuantity: 30, baseQuantity: 30 })];
    const result = run({ movementInput: { receipts: [receipt(), free(), receipt({ eventId: "PR2|1", documentNo: "PR2", date: "2026-07-01", invoiceReference: "INV-2", originalQuantity: 30, baseQuantity: 30 })], transfers } });
    expect(result.rows.find((row) => row.documentNo === "TB2")).toMatchObject({ lot: "", sourceId: "", ready: false });
    const gaps = purchaseLotGapsCsv(result);
    expect(gaps).toContain("PR2"); expect(gaps).toContain("INV-2"); expect(gaps).toContain("ยังไม่ได้ยืนยัน");
  });
});
