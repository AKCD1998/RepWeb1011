import { describe, expect, test } from "@jest/globals";
import {
  COMBINED_REPORT_GROUP,
  buildOrganicReportRequests,
  buildReportGroupScopes,
  getProductReportGroupCodes,
  resolveReportGroupCodes,
} from "../../src/lib/report1011/organicReportGroups.js";
import { mergeBranchActivityProducts } from "../../src/lib/report1011/organicReportBranches.js";
import { buildOrganicBulkReportCsv, buildOrganicReportCsv } from "../../src/lib/report1011/exportOrganicCsv.js";
import { normalizeOrganicReportCollection } from "../../src/lib/report1011/organicReportShape.js";

const products = [
  { id: "special", label: "ยากลุ่ม ขย.10", reportGroupCodes: ["KY10"] },
  { id: "dangerous", label: "ยากลุ่ม ขย.11", reportGroupCodes: ["KY11"] },
  { id: "shared", label: "ยาที่อยู่ทั้งสองกลุ่ม", reportGroupCodes: ["KY10", "KY11"] },
];
const bothGroups = resolveReportGroupCodes(COMBINED_REPORT_GROUP);

describe("combined KY10 and KY11 reports", () => {
  test("expands the combined choice into actual API groups for all selected branches", () => {
    const scopes = buildReportGroupScopes(["001", "003", "004", "005"], bothGroups);
    expect(scopes).toHaveLength(8);
    expect(new Set(scopes.map((scope) => `${scope.branchCode}:${scope.reportGroupCode}`)).size).toBe(8);
    expect(scopes.every((scope) => ["KY10", "KY11"].includes(scope.reportGroupCode))).toBe(true);
    expect(resolveReportGroupCodes("")).toEqual([]);
    expect(resolveReportGroupCodes("OTHER")).toEqual([]);
  });

  test("a mixed product selection generates only the documents to which each product belongs", () => {
    const requests = buildOrganicReportRequests(products, ["001", "005"], bothGroups);
    expect(requests).toHaveLength(8);
    expect(requests.filter((request) => request.id === "special").map((request) => request.reportGroupCode)).toEqual(["KY10", "KY10"]);
    expect(requests.filter((request) => request.id === "dangerous").map((request) => request.reportGroupCode)).toEqual(["KY11", "KY11"]);
    expect(requests.filter((request) => request.id === "shared")).toHaveLength(4);
    expect(requests.some((request) => request.reportGroupCode === COMBINED_REPORT_GROUP)).toBe(false);
  });

  test("single-group selection still creates one group per matching product and branch", () => {
    const requests = buildOrganicReportRequests(products, ["004"], resolveReportGroupCodes("KY11"));
    expect(requests.map((request) => request.id)).toEqual(["dangerous", "shared"]);
    expect(requests.every((request) => request.reportGroupCode === "KY11")).toBe(true);
    expect(getProductReportGroupCodes({ reportGroupCodes: [" ky10 ", "KY10", "KY11"] })).toEqual(bothGroups);
  });

  test("merging activities retains each branch/group scope without double-counting overlapping dispenses", () => {
    const activity = (branchCode, reportGroupCode) => ({
      id: "shared", label: "ยาที่อยู่ทั้งสองกลุ่ม", reportGroupCodes: [reportGroupCode],
      activityCount: 2, lotCount: 1, activityScopes: [{ branchCode, reportGroupCode }],
    });
    const merged = mergeBranchActivityProducts([
      [activity("001", "KY10")], [activity("001", "KY11")], [activity("005", "KY11")],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].reportGroupCodes).toEqual(bothGroups);
    expect(merged[0].activityCount).toBeNull();
    expect(merged[0].lotCount).toBeNull();
    const requests = buildOrganicReportRequests(merged, ["001", "003", "004", "005"], bothGroups);
    expect(requests.map((request) => `${request.branchCode}:${request.reportGroupCode}`)).toEqual(["001:KY10", "001:KY11", "005:KY11"]);
  });

  test("single-product mode can create both documents while empty selections create no requests", () => {
    expect(buildOrganicReportRequests([products[2]], ["004"], bothGroups)).toHaveLength(2);
    expect(buildOrganicReportRequests([products[1]], ["004"], bothGroups)).toHaveLength(1);
    expect(buildOrganicReportRequests([], ["004"], bothGroups)).toEqual([]);
    expect(buildOrganicReportRequests(products, [], bothGroups)).toEqual([]);
    expect(buildOrganicReportRequests(products, ["004"], [])).toEqual([]);
  });

  test("same-product same-branch report types remain separate in single and bulk CSV", () => {
    const reports = bothGroups.map((reportGroupCode) => ({
      monthKey: "2026-10",
      meta: { branchCode: "004", reportGroupCode, product: "Shared Product" },
      pages: [{ rows: [{ seq: 1, pid: `fixture-${reportGroupCode}`, qtyText: "1 แผง" }] }],
    }));
    const single = buildOrganicReportCsv(normalizeOrganicReportCollection({ reports }));
    const bulk = buildOrganicBulkReportCsv({
      meta: { reportGroupCode: COMBINED_REPORT_GROUP },
      items: reports.map((report) => ({ productId: "shared", branchCode: "004", reportGroupCode: report.meta.reportGroupCode, status: "success", reportData: report })),
    });
    expect(bulk.filename).toMatch(/^KY10_KY11_bulk_organic_ledger_/);
    for (const group of bothGroups) {
      expect(single.csvText).toContain(`fixture-${group}`);
      expect(bulk.csvText).toContain(`fixture-${group}`);
    }
    expect(single.csvText).toContain("กลุ่มรายงาน,KY10");
    expect(single.csvText).toContain("กลุ่มรายงาน,KY11");
    expect(bulk.csvText).toContain("กลุ่มรายงาน,KY10");
    expect(bulk.csvText).toContain("กลุ่มรายงาน,KY11");
  });
});
