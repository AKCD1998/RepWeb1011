import { formatReportLocationList, formatReportLocationName } from "./utils";
import { sanitizeReportNoteForDocument } from "./reportNotes";
import {
  formatOrganicReportMonthLabel,
  getOrganicReportObjects,
  hasOrganicReportPages,
  normalizeOrganicReportCollection,
} from "./organicReportShape";

const ORGANIC_CSV_COLUMNS = [
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
];

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

function buildOrganicReportCsvRows({ pages, meta }) {
  const rows = [ORGANIC_CSV_COLUMNS];
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
        sanitizeReportNoteForDocument(row?.note),
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

  return rows;
}

function countRowsInPages(pages) {
  return Array.isArray(pages)
    ? pages.reduce((sum, page) => sum + (Array.isArray(page?.rows) ? page.rows.length : 0), 0)
    : 0;
}

function buildDatedFilename(baseName) {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${baseName}_${year}${month}${day}.csv`;
}

function sanitizeFilenamePart(value, fallback) {
  const text = String(value || "").replace(/[\\/:*?"<>|]/g, "_").trim();
  return text || fallback;
}

export function buildOrganicReportCsv(reportData = {}) {
  const normalized = normalizeOrganicReportCollection(reportData);
  const reports = getOrganicReportObjects(normalized);
  const base = sanitizeFilenamePart(normalized?.meta?.product, "organic_report");

  if (reports.length > 1) {
    const rows = [];

    reports.forEach((report, index) => {
      const reportMeta = report?.meta || {};
      const reportPages = Array.isArray(report?.pages) ? report.pages : [];
      const branchName =
        formatReportLocationName(reportMeta?.branchCode || reportMeta?.branchNameOnly) || "";
      const monthLabel = formatOrganicReportMonthLabel(report.monthLabel || report.monthKey);
      const rowCount = countRowsInPages(reportPages);

      if (index > 0) {
        rows.push([]);
      }

      rows.push([
        "รายงานเดือน",
        monthLabel || "-",
        "ชื่อยา",
        reportMeta?.product || "",
        "กลุ่มรายงาน",
        reportMeta?.reportGroupCode || "",
        "รหัสสาขา",
        reportMeta?.branchCode || "",
        "ชื่อสาขา",
        branchName,
      ]);
      rows.push(["จำนวน lot", reportPages.length, "จำนวนรายการจ่าย", rowCount]);
      rows.push(...buildOrganicReportCsvRows(report));
    });

    return {
      filename: buildDatedFilename(`${base}_organic_ledger`),
      csvText: toCSV(rows),
    };
  }

  const targetReport = reports[0] || { pages: normalized.pages, meta: normalized.meta };
  const rows = buildOrganicReportCsvRows(targetReport);
  return {
    filename: buildDatedFilename(`${base}_organic_ledger`),
    csvText: toCSV(rows),
  };
}

export function buildOrganicBulkReportCsv({ meta, items }) {
  const successItems = Array.isArray(items)
    ? items.filter((item) => item?.status === "success" && hasOrganicReportPages(item?.reportData))
    : [];

  const rows = [];
  successItems.forEach((item, index) => {
    const normalizedReportData = normalizeOrganicReportCollection(item.reportData);
    const productReports = getOrganicReportObjects(normalizedReportData);
    const primaryMeta = normalizedReportData.meta || {};
    const branchName =
      formatReportLocationName(primaryMeta?.branchCode || primaryMeta?.branchNameOnly) || "";

    if (index > 0) {
      rows.push([]);
    }

    rows.push([
      "รายงานสินค้า",
      primaryMeta?.product || item?.productName || "",
      "รหัสสินค้า",
      primaryMeta?.productCode || item?.productCode || "",
      "กลุ่มรายงาน",
      primaryMeta?.reportGroupCode || meta?.reportGroupCode || "",
      "รหัสสาขา",
      primaryMeta?.branchCode || meta?.branchCode || "",
      "ชื่อสาขา",
      branchName,
    ]);
    productReports.forEach((report, reportIndex) => {
      const reportPages = Array.isArray(report?.pages) ? report.pages : [];
      const rowCount = countRowsInPages(reportPages);
      const monthLabel = formatOrganicReportMonthLabel(report.monthLabel || report.monthKey);

      if (reportIndex > 0) {
        rows.push([]);
      }

      rows.push([
        "ช่วงวันที่ขาย",
        meta?.dateFrom || "",
        "ถึง",
        meta?.dateTo || "",
        "เดือนรายงาน",
        monthLabel || "-",
        "จำนวน lot",
        reportPages.length,
        "จำนวนรายการจ่าย",
        rowCount,
      ]);
      rows.push(...buildOrganicReportCsvRows(report));
    });
  });

  return {
    filename: buildDatedFilename(
      `${sanitizeFilenamePart(meta?.reportGroupCode, "organic")}_bulk_organic_ledger`
    ),
    csvText: toCSV(rows),
  };
}
