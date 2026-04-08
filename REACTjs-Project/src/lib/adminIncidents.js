export const ADMIN_INCIDENT_STATUS_OPTIONS = [
  { value: "OPEN", label: "OPEN" },
  { value: "ACKNOWLEDGED", label: "ACKNOWLEDGED" },
  { value: "CLOSED", label: "CLOSED" },
];

export const ADMIN_INCIDENT_TYPE_OPTIONS = [
  { value: "DISPENSE_PROCESS_EXCEPTION", label: "Dispense process exception" },
  { value: "SMARTCARD_EXCEPTION", label: "Smartcard exception" },
  { value: "READER_OR_BRIDGE_FAILURE", label: "Reader / bridge failure" },
  { value: "DATA_CAPTURE_INCOMPLETE", label: "Data capture incomplete" },
  { value: "PROCESS_DEVIATION", label: "Process deviation" },
  { value: "OTHER", label: "Other" },
];

export const ADMIN_INCIDENT_REASON_OPTIONS = [
  { value: "DISPENSE_BEFORE_SMARTCARD", label: "ส่งมอบยาไปก่อนเสียบบัตร" },
  { value: "SMARTCARD_READER_OFFLINE", label: "smartcard reader / bridge ล่ม" },
  { value: "SMARTCARD_DATA_INCOMPLETE", label: "อ่านข้อมูลบัตรไม่ครบ" },
  { value: "STAFF_PROCESS_MISSED", label: "พนักงานทำผิด process" },
  { value: "RETROSPECTIVE_ADMIN_RECORD", label: "admin บันทึกเหตุย้อนหลัง" },
  { value: "OTHER", label: "Other" },
];

export const ADMIN_INCIDENT_RESOLUTION_ACTION_OPTIONS = [
  { value: "RETROSPECTIVE_DISPENSE", label: "สร้าง dispense ย้อนหลังและตัด stock" },
  { value: "STOCK_OUT", label: "ตัด stock อย่างเดียว (-)" },
  { value: "STOCK_IN", label: "เพิ่ม stock อย่างเดียว (+)" },
];

function toCleanText(value) {
  return String(value ?? "").trim();
}

export function getAdminIncidentStatusLabel(status) {
  const normalized = toCleanText(status).toUpperCase();
  return ADMIN_INCIDENT_STATUS_OPTIONS.find((option) => option.value === normalized)?.label || normalized || "-";
}

export function getAdminIncidentTypeLabel(type) {
  const normalized = toCleanText(type).toUpperCase();
  return ADMIN_INCIDENT_TYPE_OPTIONS.find((option) => option.value === normalized)?.label || normalized || "-";
}

export function getAdminIncidentReasonLabel(reason) {
  const normalized = toCleanText(reason).toUpperCase();
  return ADMIN_INCIDENT_REASON_OPTIONS.find((option) => option.value === normalized)?.label || normalized || "-";
}

export function getAdminIncidentResolutionActionLabel(actionType) {
  const normalized = toCleanText(actionType).toUpperCase();
  return (
    ADMIN_INCIDENT_RESOLUTION_ACTION_OPTIONS.find((option) => option.value === normalized)?.label ||
    normalized ||
    "-"
  );
}

export function formatAdminIncidentDateTime(value) {
  const text = toCleanText(value);
  if (!text) return "-";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function createAdminIncidentLocalDateTimeValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}
