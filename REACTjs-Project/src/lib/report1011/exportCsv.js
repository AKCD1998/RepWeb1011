const toCSV = (rows) => {
  const bom = "\uFEFF";
  const esc = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return bom + rows.map((row) => row.map(esc).join(",")).join("\n");
};

const fmtDateForCsv = (date) => {
  if (date instanceof Date && !Number.isNaN(date)) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return String(date || "");
};

export const buildReportCsv = ({ pages, meta }) => {
  const header = [
    "ลำดับ",
    "วันที่ขาย",
    "จำนวน(แผง)",
    "ชื่อ-สกุลผู้ซื้อ",
    "เลขบัตรประชาชน",
    "หมายเหตุ",
    "เลขที่ผลิต(ลอต)",
    "วันที่รับเข้า(ลอต)",
    "กล่อง",
    "แผง/กล่อง",
    "ชื่อยา",
    "รหัสสินค้า",
    "ผู้ผลิต/ผู้นำเข้า",
    "สาขา",
  ];

  const rows = [header];
  let seq = 0;

  for (const page of pages) {
    const lot = page.lot || {};
    for (const row of page.rows) {
      seq += 1;
      rows.push([
        seq,
        fmtDateForCsv(row.date),
        row.qty,
        row.name,
        row.pid,
        row.note || "",
        lot.batch || "",
        fmtDateForCsv(lot.date || ""),
        lot.boxes || "",
        lot.strips || "",
        meta.product || "",
        meta.sku || "",
        meta.maker || "",
        meta.branchNameOnly || "-",
      ]);
    }
  }

  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const base = (meta.product || "report").replace(/[\\/:*?"<>|]/g, "_");
  const filename = `${base}_ขย10-11_${year}${month}${day}.csv`;

  return { filename, csvText: toCSV(rows) };
};
