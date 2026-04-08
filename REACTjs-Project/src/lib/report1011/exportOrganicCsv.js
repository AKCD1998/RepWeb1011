import { formatReportLocationList, formatReportLocationName } from "./utils";

const toCSV = (rows) => {
  const bom = "\uFEFF";
  const esc = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return bom + rows.map((row) => row.map(esc).join(",")).join("\n");
};

const fmtDateForCsv = (date) => {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return String(date || "");
  }

  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
};

export function buildOrganicReportCsv({ pages, meta }) {
  const rows = [
    [
      "ลำดับ",
      "วันที่ขาย",
      "จำนวนที่ขาย",
      "ชื่อ-สกุลผู้ซื้อ",
      "เลขบัตรประชาชน",
      "เภสัชกร",
      "หมายเหตุ",
      "เลขครั้งที่ผลิต",
      "วันที่รับ",
      "จำนวนที่รับ",
      "ได้มาจาก",
      "ชื่อยา",
      "รหัสสินค้า",
      "ขนาดบรรจุ",
      "ผู้ผลิต/ผู้นำเข้า",
      "รหัสสาขา",
      "ชื่อสาขา",
      "กลุ่มรายงาน",
    ],
  ];

  let seq = 0;
  for (const page of Array.isArray(pages) ? pages : []) {
    const lot = page?.lot || {};
    for (const row of Array.isArray(page?.rows) ? page.rows : []) {
      seq += 1;
      rows.push([
        seq,
        fmtDateForCsv(row?.date),
        row?.qtyText || "",
        row?.name || "",
        row?.pid || "",
        row?.pharmacistName || "",
        row?.note || "",
        lot?.batch || "",
        fmtDateForCsv(lot?.date),
        lot?.receivedQuantityText || "",
        formatReportLocationList(lot?.sourceName) || "",
        meta?.product || "",
        meta?.productCode || "",
        meta?.packSize || "",
        meta?.maker || "",
        meta?.branchCode || "",
        formatReportLocationName(meta?.branchCode || meta?.branchNameOnly) || "",
        meta?.reportGroupCode || "",
      ]);
    }
  }

  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const base = String(meta?.product || "organic_report").replace(/[\\/:*?"<>|]/g, "_");
  const filename = `${base}_organic_ledger_${year}${month}${day}.csv`;

  return {
    filename,
    csvText: toCSV(rows),
  };
}
