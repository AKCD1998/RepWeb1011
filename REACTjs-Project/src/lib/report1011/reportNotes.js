const REPORT_METADATA_TAG_PATTERN =
  /\[(?:[^\]]*?(?:reportType|source|lotNo|incidentCode|actionType)=[^\]]*?)\]/gi;

const INCIDENT_NOTE_PATTERN =
  /\bINC-\d{6,}\b|incidentCode\s*=|source\s*=\s*INCIDENT_RESOLUTION|actionType\s*=\s*RETROSPECTIVE_DISPENSE|(?:สร้าง)?ย้อนหลังจาก\s*incident/iu;

const INTERNAL_NOTE_LABEL_PATTERN =
  /^(?:lotNo|source|incidentCode|actionType|reportType|ผู้รับมอบยา|ชื่อผู้รับมอบยา|เลขประจำตัวประชาชน|ชื่อภาษาอังกฤษ|วันเกิด|เพศ|ที่อยู่)\s*[:=]/iu;

function normalizeInlineWhitespace(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function sanitizeReportNoteForDocument(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  return text
    .replace(REPORT_METADATA_TAG_PATTERN, " | ")
    .split(/\s*\|\s*|\r?\n+/u)
    .map((part) => normalizeInlineWhitespace(part))
    .filter((part) => part && !INCIDENT_NOTE_PATTERN.test(part) && !INTERNAL_NOTE_LABEL_PATTERN.test(part))
    .join(" | ");
}
