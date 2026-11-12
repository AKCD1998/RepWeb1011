import { describe, expect, jest, test } from "@jest/globals";
import { buildReport } from "../../src/lib/report1011/buildReport.js";
import { buildBulkReportItem } from "../../src/lib/report1011/buildBulkReport.js";

const validPid = "0000000000001";
const lots = [{ batch: "TEST-LOT", date: "2026-06-01", expiry: "2028-01-01", boxes: 1, strips: 10 }];
const group = {
  key: "005|TEST-SKU", branchId: "005", totalSold: 3,
  product: { code: "TEST-SKU", value: "ยาทดสอบ : 10 แผง", maker: "ผู้ผลิตทดสอบ" },
  sales: [{ date: "2026-07-01", qty: 1 }, { date: "2026-07-02", qty: 2 }],
};
const build = (mode, patientsCsvText, lotAllocation) => mode === "bulk"
  ? buildBulkReportItem({ group, lots, patientsCsvText, lotAllocation, sku: "test" })
  : buildReport({
    lots, patientsCsvText, lotAllocation, branchId: "005", productName: group.product.value,
    // Match the bulk adapter's detection-only first data row.
    salesCsvText: "วันที่,จำนวน\n01/07/2026,1\n01/07/2026,1\n02/07/2026,2",
  });

describe.each(["single", "bulk"])("%s report buyer PID validation", (mode) => {
  test.each(["received", "fefo"])("excludes malformed IDs before %s allocation without losing sales", (lotAllocation) => {
    const csv = [
      "pid,full_name", "Awf,ผู้ซื้อทดสอบ", `${validPid},ผู้ซื้อทดสอบ`,
      "123456789012,ผู้ซื้อเลขสั้น", "12345678901234,ผู้ซื้อเลขยาว", ",ผู้ซื้อไม่มีเลข",
    ].join("\n");
    // Before validation this always selects the first malformed buyer.
    const random = jest.spyOn(Math, "random").mockReturnValue(0);
    try {
      const result = build(mode, csv, lotAllocation);
      expect(result.error).toBeUndefined();
      const rows = result.pages.flatMap((page) => page.rows);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.pid)).toEqual([validPid, validPid]);
      expect(rows.map((row) => row.name)).toEqual(["ผู้ซื้อทดสอบ", "ผู้ซื้อทดสอบ"]);
      expect(rows.reduce((sum, row) => sum + row.qty, 0)).toBe(3);
    } finally { random.mockRestore(); }
  });

  test.each(["Awf", "123456789012", "12345678901234", "", "123456789012x"])(
    "stops before allocation when no eligible buyer remains (%s)", (pid) => {
      const random = jest.spyOn(Math, "random");
      try {
        const result = build(mode, `pid,full_name\n${pid},ผู้ซื้อทดสอบ`, "fefo");
        expect(result.error).toContain("13 หลัก");
        expect(result.pages || []).toEqual([]);
        expect(random).not.toHaveBeenCalled();
      } finally { random.mockRestore(); }
    },
  );
});
