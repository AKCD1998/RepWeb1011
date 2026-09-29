import { describe, expect, jest, test } from "@jest/globals";
import { buildBulkReportCsv, buildBulkReportItem } from "../../src/lib/report1011/buildBulkReport.js";
import { buildLotsTemplate, createBulkSource, importBulkSources, normalizeBulkDate, normalizeBulkProducts, normalizeBulkSaleTimestamp, resolveBulkProduct, validateBulkLots } from "../../src/lib/report1011/bulkImport.js";
import { parseCsv } from "../../src/lib/report1011/csv.js";

const branches = ["001", "003", "004", "005"].map((value) => ({ value, label: `${value} : สาขา ${value}` }));
const catalog = [
  { id: "p1", productCode: "IC-001", tradeName: "ยาทดสอบ A", packageSize: "1 กล่อง x 10 แผง", manufacturerName: "ผู้ผลิตทดสอบ", reportGroupCodes: ["KY11"] },
  { id: "p2", productCode: "IC-002", tradeName: "ยาทดสอบ B", packageSize: "1 กล่อง x 1 ขวด", reportGroupCodes: ["KY11"] },
  { id: "p3", productCode: "IC-003", tradeName: "ยาทดสอบ C", reportGroupCodes: ["KY10"] },
];
const products = normalizeBulkProducts(catalog);
const patientsCsvText = "pid,full_name\n0000000000001,ผู้ทดสอบระบบหนึ่ง\n0000000000002,ผู้ทดสอบระบบสอง";
const source = (text, name = "sales.csv") => createBulkSource(text, name);
const load = (sources, extra = {}) => importBulkSources({ sources, products, branches, ...extra });
const standardHeader = "branchCode,productCode,saleDate,quantity,billNo,unit\n";

describe("bulk sales import", () => {
  test("separates product/branch jobs, includes 005 and preserves every first sale", () => {
    const result = load([source(standardHeader + "001,IC-001,21/06/2569,2,B1,แผง\n003,IC-001,2026-06-22,3,B2,แผง\n005,IC-002,2026-06-23,1,B3,ขวด")]);
    expect(result.errors).toEqual([]);
    expect(result.groups.map((group) => [group.branchId, group.product.code, group.totalSold])).toEqual([["001", "IC-001", 2], ["003", "IC-001", 3], ["005", "IC-002", 1]]);
  });
  test("counts KY10 exclusions instead of creating KY11 for those rows", () => {
    const result = load([source(standardHeader + "001,IC-003,2026-07-01,1,X,แผง")]);
    expect(result.groups).toEqual([]);
    expect(result.excluded.otherReportGroup).toBe(1);
  });
  test("reports unknown SKU and branch instead of guessing", () => {
    const result = load([source(standardHeader + "001,MISSING,2026-07-01,1,X,แผง\n099,IC-001,2026-07-01,1,Y,แผง")]);
    expect(result.errors).toHaveLength(2);
  });
  test("rejects ambiguous product names with different packs", () => {
    expect(resolveBulkProduct("ยาทดสอบ A", [...products, { ...products[0], id: "p4", code: "IC-004", pack: "20", value: "ยาทดสอบ A : 20" }])).toBeNull();
  });
  test("inclusive date filtering counts excluded rows", () => {
    const result = load([source(standardHeader + "001,IC-001,2026-06-30,1,A,แผง\n001,IC-001,2026-07-01,1,B,แผง\n001,IC-001,2026-07-31,2,C,แผง\n001,IC-001,2026-08-01,1,D,แผง")], { dateFrom: "2026-07-01", dateTo: "2026-07-31" });
    expect(result.groups[0].totalSold).toBe(3);
    expect(result.excluded.outsidePeriod).toBe(2);
  });
  test.each(["-1", "0", "1.5", "abc", "2 แผง", "Infinity"])("invalid quantity %s is visible as an import error", (qty) => {
    expect(load([source(standardHeader + `001,IC-001,2026-07-01,${qty},X,แผง`)]).errors).toHaveLength(1);
  });
  test("duplicates by product/branch/bill are counted and conflicts block", () => {
    const result = load([source(standardHeader + "001,IC-001,2026-07-01,2,A,แผง", "a.csv"), source(standardHeader + "001,IC-001,2026-07-01,2,A,แผง\n001,IC-001,2026-07-01,3,A,แผง", "b.csv")]);
    expect(result.groups[0].totalSold).toBe(2);
    expect(result.excluded.duplicates).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
  test("identical dates/quantities without bill IDs are retained", () => {
    const result = load([source("วันที่,จำนวน\n21/06/2569,1\n21/06/2569,1")].map((entry) => ({ ...entry, branchId: "001", productId: "p1" })));
    expect(result.groups[0].totalSold).toBe(2);
  });
  test("legacy padding is removed only when explicitly selected", () => {
    const entry = { ...source("วันที่,จำนวน\n21/06/2569,1\n21/06/2569,1"), branchId: "001", productId: "p1", skipLegacyFirstRow: true };
    expect(load([entry]).groups[0].totalSold).toBe(1);
  });
  test("POS JSON imports original sales rather than only inferred allocations", () => {
    const entry = createBulkSource(JSON.stringify({ rows: [{ branch: "001", code: "IC-001", at_local: "2026-07-01T10:00:00", qty_original: 5, assigned_qty: 2, allocations: [], patient_name: "do not import", national_id: "do not import", bill: "A" }] }), "pos.json");
    const result = load([entry]);
    expect(result.groups[0].totalSold).toBe(5);
    expect(JSON.stringify(result)).not.toContain("do not import");
  });
  test("CSV BOM, quoted fields and Thai headers work", () => {
    const result = load([source('\uFEFFสาขา,รหัสสินค้า,วันที่ขาย,จำนวนขาย\n1,IC-001,01/07/2569,"1,000"')]);
    expect(result.groups[0].totalSold).toBe(1000);
  });
  test("preserves Bangkok times, including a separate sale_time column", () => {
    const result = load([source("branch,ic_code,sale_date,sale_time,quantity\n001,IC-001,21/06/2569,18:01:25,1")]);
    expect(result.groups[0].sales[0]).toMatchObject({ date: "2026-06-21", time: "18:01:25" });
    expect(normalizeBulkSaleTimestamp("2026-07-01T25:00:00")).toBeNull();
  });
  test("hides internal catalog conversion factors while retaining exact lookup", () => {
    const options = normalizeBulkProducts([{ ...catalog[0], packageSize: "1 กล่อง x 10 แผง (factor=10)" }]);
    expect(options[0].pack).toBe("1 กล่อง x 10 แผง");
    expect(resolveBulkProduct("ยาทดสอบ A : 1 กล่อง x 10 แผง (factor=10)", options)?.id).toBe("p1");
  });
});

describe("dates and branch lots", () => {
  test.each([["01/07/2569 12:30:00", "2026-07-01"], ["2026-07-01T12:30:00", "2026-07-01"], ["31/02/2569", ""], ["2026-13-01", ""], ["29/02/2024", "2024-02-29"]])("date %s normalizes to %s", (value, expected) => expect(normalizeBulkDate(value)).toBe(expected));
  test("lot capacities remain separate across branches", () => {
    const lots = createBulkSource("branchCode,productCode,batch,received_date,boxes,units_per_box\n001,IC-001,A,2026-06-01,2,10\n005,IC-001,B,2026-06-01,1,10", "lots.csv", "lots", "lots");
    const result = load([lots], { kind: "lots" });
    expect(result.errors).toEqual([]);
    expect(result.groups.map((group) => [group.branchId, group.lots[0].boxes])).toEqual([["001", 2], ["005", 1]]);
    expect(validateBulkLots(result.groups[1].lots, 11)).toContain("ลอตไม่พอ");
  });
  test("template leaves unknown receipts blank instead of manufacturing quantities", () => {
    const groups = load([source(standardHeader + "005,IC-002,2026-07-01,1,A,ขวด")]).groups;
    expect(parseCsv(buildLotsTemplate(groups))[1]).toEqual(["005", "IC-002", "", "", "", ""]);
  });
});

describe("bulk generation through the existing report builder", () => {
  const groupFor = (qty = 5) => load([source(standardHeader + `005,IC-001,2026-07-01,${qty},A,แผง\n005,IC-001,2026-07-02,1,B,แผง`)]).groups[0];
  const lots = [{ batch: "TEST-LOT", date: "2026-06-01", boxes: 2, strips: 10 }];
  test("all sales, first row, existing quantity splitting and system patients survive", () => {
    const result = buildBulkReportItem({ group: groupFor(), lots, patientsCsvText, sku: "แหล่งทดสอบ" });
    expect(result.status).toBe("success");
    expect(result.pages.flatMap((page) => page.rows).map((row) => row.qty)).toEqual([2, 2, 1, 1]);
    expect(result.totalSold).toBe(6);
    expect(result.meta.branchCode).toBe("005");
    expect(result.meta.branchNameOnly).toBe("-"); // legacy unchanged; preview uses branchCode
    expect(result.pages.flatMap((page) => page.rows).every((row) => ["0000000000001", "0000000000002"].includes(row.pid))).toBe(true);
  });
  test("passes original sale times into the untouched patient allocation algorithm", () => {
    const group = load([source(standardHeader + "001,IC-001,2026-07-01T18:01:25,1,A,แผง")]).groups[0];
    const result = buildBulkReportItem({ group, lots, patientsCsvText, sku: "test" });
    expect(result.pages[0].rows[0].date.getHours()).toBe(18);
    expect(result.pages[0].rows[0].date.getMinutes()).toBe(1);
    expect(result.pages[0].rows[0].date.getSeconds()).toBe(25);
  });
  test("supports quantities above the legacy CSV detector limit without loss", () => {
    const result = buildBulkReportItem({ group: groupFor(501), lots: [{ ...lots[0], boxes: 60 }], patientsCsvText, sku: "test" });
    expect(result.status).toBe("success");
    expect(result.totalSold).toBe(502);
  });
  test("insufficient lots return a per-job error before allocating patients", () => {
    const random = jest.spyOn(Math, "random");
    const result = buildBulkReportItem({ group: groupFor(30), lots, patientsCsvText, sku: "test" });
    expect(result.status).toBe("error");
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
  test("a later receipt does not produce an apparently complete report", () => {
    const result = buildBulkReportItem({ group: groupFor(), lots: [{ ...lots[0], date: "2026-08-01" }], patientsCsvText, sku: "test" });
    expect(result.error).toContain("ก่อนวันที่รับลอต");
  });
  test("detects legacy per-box over-allocation without altering its algorithm", () => {
    const result = buildBulkReportItem({ group: groupFor(), lots: [{ ...lots[0], boxes: 2, strips: 3 }], patientsCsvText, sku: "test" });
    expect(result.error).toContain("เกินลอต");
  });
  test("combined CSV includes only successful jobs with branch and product codes", () => {
    const result = buildBulkReportItem({ group: groupFor(), lots, patientsCsvText, sku: "test" });
    const csv = parseCsv(buildBulkReportCsv([result, { status: "error" }]).csvText);
    expect(csv).toHaveLength(5);
    expect(csv[1].slice(0, 2)).toEqual(["005", "IC-001"]);
    expect(csv.slice(1).reduce((sum, row) => sum + Number(row[5]), 0)).toBe(6);
  });
});
