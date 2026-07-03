export const stripBOM = (text) => String(text || "").replace(/^\uFEFF/, "");

const REPORT_LOCATION_NAME_MAP = new Map([
  ["HEADOFFICE", "สำนักงานใหญ่ บริษัท เอสซี กรุ๊ป(1989) จำกัด"],
  ["HEAD OFFICE", "สำนักงานใหญ่ บริษัท เอสซี กรุ๊ป(1989) จำกัด"],
  ["OFFICE_MAIN", "สำนักงานใหญ่ บริษัท เอสซี กรุ๊ป(1989) จำกัด"],
  ["001", "สาขาตลาดแม่กลอง"],
  ["BRANCH001", "สาขาตลาดแม่กลอง"],
  ["BRANCH 001", "สาขาตลาดแม่กลอง"],
  ["ตลาดแม่กลอง", "สาขาตลาดแม่กลอง"],
  ["สาขาตลาดแม่กลอง", "สาขาตลาดแม่กลอง"],
  ["003", "สาขาวัดช่องลม"],
  ["BRANCH003", "สาขาวัดช่องลม"],
  ["BRANCH 003", "สาขาวัดช่องลม"],
  ["วัดช่องลม", "สาขาวัดช่องลม"],
  ["สาขาวัดช่องลม", "สาขาวัดช่องลม"],
  ["004", "สาขาตลาดบางน้อย"],
  ["BRANCH004", "สาขาตลาดบางน้อย"],
  ["BRANCH 004", "สาขาตลาดบางน้อย"],
  ["ตลาดบางน้อย", "สาขาตลาดบางน้อย"],
  ["สาขาตลาดบางน้อย", "สาขาตลาดบางน้อย"],
  ["005", "สาขาถนนเอกชัยสมุทรสาคร"],
  ["BRANCH005", "สาขาถนนเอกชัยสมุทรสาคร"],
  ["BRANCH 005", "สาขาถนนเอกชัยสมุทรสาคร"],
  ["ถนนเอกชัยสมุทรสาคร", "สาขาถนนเอกชัยสมุทรสาคร"],
  ["สาขาถนนเอกชัยสมุทรสาคร", "สาขาถนนเอกชัยสมุทรสาคร"],
]);

const normalizeLocationLookupKey = (value) => String(value || "").trim().replace(/\s+/g, " ").toUpperCase();

const compactLocationLookupKey = (value) =>
  normalizeLocationLookupKey(value).replace(/[\s_-]+/g, "");

export const formatReportLocationName = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";

  const mapped =
    REPORT_LOCATION_NAME_MAP.get(normalizeLocationLookupKey(text)) ||
    REPORT_LOCATION_NAME_MAP.get(compactLocationLookupKey(text));

  if (mapped) return mapped;

  const branchCodeMatch = text.match(/\b(001|003|004|005)\b/);
  if (branchCodeMatch?.[1]) {
    return REPORT_LOCATION_NAME_MAP.get(branchCodeMatch[1]) || text;
  }

  return text;
};

export const formatReportLocationList = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";

  return text
    .split(/\s*,\s*/u)
    .map((part) => formatReportLocationName(part))
    .filter(Boolean)
    .join(", ");
};

export const fmtThai = (date) => {
  try {
    return new Date(date).toLocaleDateString("th-TH", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "";
  }
};

export const isDateLike = (value) => {
  if (!value) return false;
  const text = String(value).trim();
  return /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[,\s]+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(
    text
  );
};

export const parseThaiDateLoose = (value) => {
  const text = String(value).trim();
  const match = text.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) return new Date(NaN);
  let day = Number(match[1]);
  let month = Number(match[2]);
  let year = Number(match[3]);
  if (year > 2400) year -= 543;
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  return new Date(year, month - 1, day, hour, minute, second);
};

export const toNumberSafe = (value) => {
  const num = Number(String(value).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(num) ? num : 0;
};

export const parseProductLine = (text) => {
  const parts = String(text || "").split(":");
  const [name, ...rest] = parts;
  return {
    name: (name || "").trim(),
    pack: rest.join(":").trim(),
  };
};
