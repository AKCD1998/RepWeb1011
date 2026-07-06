import { describe, expect, test } from "@jest/globals";
import {
  countOrganicReportLots,
  countOrganicReportRows,
  getOrganicReportObjects,
  hasOrganicReportPages,
  normalizeOrganicReportCollection,
} from "../../src/lib/report1011/organicReportShape.js";
import { buildOrganicBulkReportCsv, buildOrganicReportCsv } from "../../src/lib/report1011/exportOrganicCsv.js";

function createMultiMonthReportData() {
  return {
    meta: {
      product: "Test Product",
      productCode: "SKU-1",
      reportGroupCode: "KY11",
      branchCode: "003",
      branchNameOnly: "Branch 003",
      branchLabel: "003 : Branch 003",
      maker: "Maker",
      packSize: "1 x 10",
    },
    reports: [
      {
        monthKey: "2026-07",
        monthLabel: "2026-07",
        meta: {
          product: "Test Product",
          productCode: "SKU-1",
          reportGroupCode: "KY11",
          branchCode: "003",
          branchNameOnly: "Branch 003",
          branchLabel: "003 : Branch 003",
          maker: "Maker",
          packSize: "1 x 10",
          reportMonthKey: "2026-07",
          reportMonthLabel: "2026-07",
        },
        pages: [
          {
            lot: {
              batch: "LOT-001",
              date: "2026-06-01T00:00:00.000Z",
              receivedQuantityText: "10 กล่อง",
              sourceName: "สำนักงานใหญ่",
            },
            rows: [
              {
                date: "2026-07-10T08:00:00.000Z",
                qtyText: "1 แผง",
                name: "July Buyer",
                pid: "1111111111111",
                pharmacistName: "เภสัช ก",
                note: "กรกฎาคม",
              },
            ],
          },
        ],
      },
      {
        monthKey: "2026-08",
        monthLabel: "2026-08",
        meta: {
          product: "Test Product",
          productCode: "SKU-1",
          reportGroupCode: "KY11",
          branchCode: "003",
          branchNameOnly: "Branch 003",
          branchLabel: "003 : Branch 003",
          maker: "Maker",
          packSize: "1 x 10",
          reportMonthKey: "2026-08",
          reportMonthLabel: "2026-08",
        },
        pages: [
          {
            lot: {
              batch: "LOT-001",
              date: "2026-06-01T00:00:00.000Z",
              receivedQuantityText: "10 กล่อง",
              sourceName: "สำนักงานใหญ่",
            },
            rows: [
              {
                date: "2026-08-11T08:00:00.000Z",
                qtyText: "1 แผง",
                name: "August Buyer",
                pid: "2222222222222",
                pharmacistName: "เภสัช ข",
                note: "สิงหาคม",
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("organic report multi-month shape", () => {
  test("normalizes reports and preserves compatibility counts", () => {
    const normalized = normalizeOrganicReportCollection(createMultiMonthReportData());

    expect(getOrganicReportObjects(normalized)).toHaveLength(2);
    expect(countOrganicReportLots(normalized)).toBe(2);
    expect(countOrganicReportRows(normalized)).toBe(2);
    expect(hasOrganicReportPages(normalized)).toBe(true);
  });

  test("wraps legacy single-report payloads into one report object", () => {
    const normalized = normalizeOrganicReportCollection({
      meta: { product: "Legacy Product" },
      pages: [{ lot: { batch: "LOT-LEGACY" }, rows: [{ name: "Legacy Buyer" }] }],
    });

    expect(getOrganicReportObjects(normalized)).toHaveLength(1);
    expect(countOrganicReportLots(normalized)).toBe(1);
    expect(countOrganicReportRows(normalized)).toBe(1);
  });
});

describe("organic report multi-month csv", () => {
  test("single-product csv includes separate month sections", () => {
    const result = buildOrganicReportCsv(createMultiMonthReportData());

    expect(result.filename).toMatch(/Test Product_organic_ledger_/);
    expect(result.csvText).toContain("รายงานเดือน");
    expect(result.csvText).toContain("07/2026");
    expect(result.csvText).toContain("08/2026");
    expect(result.csvText).toContain("July Buyer");
    expect(result.csvText).toContain("August Buyer");
  });

  test("bulk csv includes monthly sections per successful product", () => {
    const result = buildOrganicBulkReportCsv({
      meta: {
        reportGroupCode: "KY11",
        branchCode: "003",
        dateFrom: "2026-07-01",
        dateTo: "2026-08-31",
      },
      items: [
        {
          productId: "product-1",
          productName: "Test Product",
          productCode: "SKU-1",
          status: "success",
          reportData: createMultiMonthReportData(),
        },
      ],
    });

    expect(result.filename).toMatch(/KY11_bulk_organic_ledger_/);
    expect(result.csvText).toContain("เดือนรายงาน");
    expect(result.csvText).toContain("07/2026");
    expect(result.csvText).toContain("08/2026");
    expect(result.csvText).toContain("July Buyer");
    expect(result.csvText).toContain("August Buyer");
  });
});
