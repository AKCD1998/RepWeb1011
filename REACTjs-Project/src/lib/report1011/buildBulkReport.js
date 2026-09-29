import { buildReport } from "./buildReport.js";
import { validateBulkLots } from "./bulkImport.js";

export function buildBulkReportItem({ group, lots, patientsCsvText, sku }) {
  const error = validateBulkLots(lots, group.totalSold);
  if (error) return { key: group.key, status: "error", error };
  if (!group.sales.length) return { key: group.key, status: "error", error: "ไม่มีประวัติขายในช่วงวันที่เลือก" };
  if (group.totalSold > 100000) return { key: group.key, status: "error", error: "ยอดต่อรายงานเกิน 100,000 หน่วย โปรดแบ่งช่วงวันที่" };
  if (!patientsCsvText) return { key: group.key, status: "error", error: "ไม่สามารถโหลดรายชื่อผู้ป่วยได้" };

  const rows = [];
  for (const sale of group.sales) {
    const [year, month, day] = sale.date.split("-");
    // The legacy detector skips its first valid numeric data row. Supply a
    // detection-only row before the real sales, leaving that shared code intact.
    // Chunk large totals to its existing 500-unit CSV input limit.
    let remaining = sale.qty;
    while (remaining > 0) {
      const qty = Math.min(remaining, 500);
      rows.push(`${day}/${month}/${year}${sale.time ? ` ${sale.time}` : ""},${qty}`);
      remaining -= qty;
    }
  }
  const salesCsvText = ["วันที่,จำนวน", rows[0], ...rows].join("\n");
  const result = buildReport({
    lots: lots.map((lot) => ({ ...lot, boxes: Number(lot.boxes), strips: Number(lot.strips) })),
    salesCsvText, patientsCsvText, sku, branchId: group.branchId,
    productName: group.product.value, maker: group.product.maker,
  });
  if (result.error) return { key: group.key, status: "error", error: result.error };
  if (result.warning) return { key: group.key, status: "error", error: `ลอตไม่พอ ขาด ${result.warning.deficit} หน่วย` };
  const totalOutput = result.pages.reduce((sum, page) => sum + page.rows.reduce((quantity, row) => quantity + row.qty, 0), 0);
  if (totalOutput !== group.totalSold || result.totals?.totalSold !== group.totalSold) return { key: group.key, status: "error", error: "ยอดในรายงานไม่ตรงกับยอดนำเข้า โปรดตรวจข้อมูล" };
  // Detect a legacy lot-allocation edge case without changing its algorithm.
  if (result.pages.some((page) => page.rows.reduce((sum, row) => sum + row.qty, 0) > page.lot.strips)) return { key: group.key, status: "error", error: "การจัดสรรเดิมใช้หน่วยเกินลอต โปรดตรวจขนาดบรรจุและลอต" };
  if (result.pages.some((page) => page.rows.some((row) => {
    const [year, month, day] = page.lot.date.split("-").map(Number);
    return row.date < new Date(year, month - 1, day);
  }))) return { key: group.key, status: "error", error: "การจัดสรรเดิมพบยอดขายก่อนวันที่รับลอต โปรดตรวจลอตของสาขานี้" };
  return { key: group.key, status: "success", group, pages: result.pages,
    meta: { ...result.meta, branchCode: group.branchId, productCode: group.product.code, reportGroupCode: "KY11" }, totalSold: totalOutput };
}

export function buildBulkReportCsv(items) {
  const escape = (value) => {
    let text = String(value ?? "");
    // Treat text as text when a CSV is opened in Excel.
    if (/^[=+@\-]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [["สาขา", "รหัสสินค้า", "ชื่อยา", "ขนาดบรรจุ", "วันที่ขาย", "จำนวน(หน่วยรายงาน)", "ชื่อ-สกุลผู้ซื้อ", "เลขบัตรประชาชน", "เลขลอต", "วันที่รับเข้า", "ผู้ผลิต/ผู้นำเข้า", "ได้มาจาก"]];
  for (const item of items.filter((entry) => entry.status === "success")) {
    for (const page of item.pages) for (const row of page.rows) rows.push([
      item.meta.branchCode, item.meta.productCode, item.meta.product, item.meta.packSize,
      `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, "0")}-${String(row.date.getDate()).padStart(2, "0")}`,
      row.qty, row.name, row.pid, page.lot.batch, page.lot.date, item.meta.maker, item.meta.sku,
    ]);
  }
  return { filename: "ขย11_bulk.csv", csvText: "\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\n") };
}
