import test from "node:test";
import assert from "node:assert/strict";
import { summarizeFrozenSales, frozenArtifactLabel, JUL_SEP_R4_KEY } from "../../src/lib/report1011/bulkArchive.js";

const header = ["branchCode", "productCode", "snapshotProductName", "quantity", "printedQuantity", "pendingQuantity", "reportStatus", "reportNote"];
test("frozen totals preserve held sale quantities and products absent from the live catalog", () => {
  const value = summarizeFrozenSales({ header, rows: [
    ["001", "IC-X", "ชื่อจากชุดหลักฐาน", "5", "3", "2", "PARTIAL_LOT_DRAFT", "รอตรวจยอด"],
    ["001", "IC-X", "ชื่อจากชุดหลักฐาน", "2", "2", "0", "PARTIAL_LOT_DRAFT", "รอตรวจยอด"],
    ["005", "IC-Y", "อีกสินค้า", "1", "1", "0", "POLICY_INFERENCE_DRAFT", ""],
  ] });
  assert.deepEqual([value.sold, value.printed, value.pending], [8, 6, 2]);
  assert.equal(value.groups.length, 2);
  assert.equal(value.groups[0].name, "ชื่อจากชุดหลักฐาน");
  assert.equal(value.groups[0].pending, 2);
  assert.throws(() => summarizeFrozenSales({ header, rows: [["001", "IC-X", "x", "5", "5", "1"]] }), /ไม่ตรงกัน/);
});
test("artifact labels distinguish quarter, month and print-once files", () => {
  assert.equal(frozenArtifactLabel({ key: "combined", pageCount: 10 }), "รวมทุกสาขา · 10 หน้า");
  assert.equal(frozenArtifactLabel({ key: "branch-005-2026-09", branchCode: "005", pageCount: 3 }), "สาขา 005 · กันยายน · 3 หน้า");
  assert.match(frozenArtifactLabel({ key: "branch-001", branchCode: "001", pageCount: 4 }), /รวม 3 เดือน/);
  assert.equal(JUL_SEP_R4_KEY, "ada-pos-20260701-20260930-ky11-r4-draft-v1");
});
