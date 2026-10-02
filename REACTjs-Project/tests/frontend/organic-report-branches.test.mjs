import { describe, expect, test } from "@jest/globals";
import {
  ALL_REPORT_BRANCHES,
  buildBranchProductRequests,
  getAllReportBranchesLabel,
  mergeBranchActivityProducts,
  resolveReportBranchCodes,
} from "../../src/lib/report1011/organicReportBranches.js";
import { buildOrganicReportCsv, buildOrganicBulkReportCsv } from "../../src/lib/report1011/exportOrganicCsv.js";
import { countOrganicReportRows, normalizeOrganicReportCollection } from "../../src/lib/report1011/organicReportShape.js";

const branches = ["005", "001", "004", "003"].map((code) => ({ code }));
const product = { id: "p1", label: "สินค้าทดสอบ", activityCount: 2, lotCount: 1 };
const branchReport = (branchCode) => ({
  monthKey: "2026-10",
  meta: { branchCode, reportGroupCode: "KY11", product: "สินค้าทดสอบ", dateFrom: "2026-10-01", dateTo: "2026-10-02" },
  pages: [{ lotNo: "SAME-LOT", rows: [{ seq: 1, date: "2026-10-01", pid: `patient-${branchCode}`, name: `ผู้รับสาขา ${branchCode}`, qty: "1 แผง" }] }],
});

describe("organic reports across branches", () => {
  test("shows the current branches in code order and includes a newly added branch", () => {
    expect(getAllReportBranchesLabel(branches)).toBe("ทุกสาขา (001,003,004,005)");
    expect(getAllReportBranchesLabel([...branches, { code: "006" }])).toBe("ทุกสาขา (001,003,004,005,006)");
  });

  test("excludes inactive, duplicate, and missing codes from the displayed scope and requests", () => {
    const catalog = [...branches, { code: "001" }, { code: "006", is_active: false }, { code: "007", isActive: false }, {}];
    expect(getAllReportBranchesLabel(catalog)).toBe("ทุกสาขา (001,003,004,005)");
    expect(resolveReportBranchCodes(ALL_REPORT_BRANCHES, catalog, true)).toEqual(["001", "003", "004", "005"]);
    expect(getAllReportBranchesLabel([])).toBe("");
  });

  test("the all-branches value cannot expand a non-admin request", () => {
    expect(resolveReportBranchCodes(ALL_REPORT_BRANCHES, branches, false)).toEqual([]);
    expect(resolveReportBranchCodes("004", branches, false)).toEqual(["004"]);
    expect(resolveReportBranchCodes("004", branches, true)).toEqual(["004"]);
    expect(resolveReportBranchCodes("", branches, true)).toEqual([]);
  });

  test("products shared by branches appear once while products exclusive to one branch remain selectable", () => {
    const merged = mergeBranchActivityProducts([
      [product],
      [{ ...product, activityCount: 3, lotCount: 2 }, { id: "p2", label: "อีกสินค้า", activityCount: 1, lotCount: 1 }],
      [],
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((entry) => entry.id === "p1")).toMatchObject({ activityCount: 5, lotCount: 3 });
    expect(product.activityCount).toBe(2);
    const requests = buildBranchProductRequests(merged, resolveReportBranchCodes(ALL_REPORT_BRANCHES, branches, true));
    expect(requests).toHaveLength(8);
    expect(new Set(requests.map((entry) => `${entry.branchCode}:${entry.id}`)).size).toBe(8);
    expect(requests.some((entry) => entry.branchCode === ALL_REPORT_BRANCHES)).toBe(false);
  });

  test("same-month and same-lot reports retain separate branch metadata and CSV rows", () => {
    const reports = branches.map(({ code }) => branchReport(code));
    const combined = normalizeOrganicReportCollection({ reports });
    expect(countOrganicReportRows(combined)).toBe(4);
    expect(combined.reports.map((report) => report.meta.branchCode)).toEqual(["005", "001", "004", "003"]);
    const singleCsv = buildOrganicReportCsv(combined).csvText;
    const bulkCsv = buildOrganicBulkReportCsv({
      meta: { reportGroupCode: "KY11", dateFrom: "2026-10-01", dateTo: "2026-10-02" },
      items: reports.map((report) => ({ branchCode: report.meta.branchCode, productId: "p1", status: "success", reportData: report })),
    }).csvText;
    for (const { code } of branches) {
      expect(singleCsv).toContain(`patient-${code}`);
      expect(bulkCsv).toContain(`patient-${code}`);
    }
  });
});
