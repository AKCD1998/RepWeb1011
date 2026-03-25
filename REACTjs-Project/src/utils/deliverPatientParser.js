const THAI_MONTH_INDEX = {
  มกราคม: 1,
  มกรา: 1,
  มค: 1,
  กุมภาพันธ์: 2,
  กุมภา: 2,
  กพ: 2,
  มีนาคม: 3,
  มีนา: 3,
  มีค: 3,
  เมษายน: 4,
  เมษา: 4,
  เมย: 4,
  พฤษภาคม: 5,
  พฤษภา: 5,
  พค: 5,
  มิถุนายน: 6,
  มิถุนา: 6,
  มิย: 6,
  กรกฎาคม: 7,
  กรกฎา: 7,
  กค: 7,
  สิงหาคม: 8,
  สิงหา: 8,
  สค: 8,
  กันยายน: 9,
  กันยา: 9,
  กย: 9,
  ตุลาคม: 10,
  ตุลา: 10,
  ตค: 10,
  พฤศจิกายน: 11,
  พฤศจิกา: 11,
  พย: 11,
  ธันวาคม: 12,
  ธันวา: 12,
  ธค: 12,
};

function toCleanText(value) {
  return String(value || "").trim();
}

function normalizeLabel(value) {
  return toCleanText(value).replace(/\s+/g, "").toLowerCase();
}

function normalizeMonthToken(value) {
  return normalizeLabel(value).replace(/\./g, "");
}

function normalizeYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return null;
  if (year > 2400) return year - 543;
  if (year < 100) return year + 2000;
  return year;
}

function toIsoDate(yearValue, monthValue, dayValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1900 || year > 3000) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateValue(rawValue) {
  const value = toCleanText(rawValue);
  if (!value) return null;

  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const slashMatch = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const year = normalizeYear(slashMatch[3]);
    return year ? toIsoDate(year, month, day) : null;
  }

  const thaiTextMatch = value.match(/^(\d{1,2})\s+([^\s]+)\s+(\d{2,4})$/u);
  if (thaiTextMatch) {
    const day = Number(thaiTextMatch[1]);
    const month = THAI_MONTH_INDEX[normalizeMonthToken(thaiTextMatch[2])] || null;
    const year = normalizeYear(thaiTextMatch[3]);
    if (!month || !year) return null;
    return toIsoDate(year, month, day);
  }

  return null;
}

function normalizeSex(rawValue) {
  const value = toCleanText(rawValue).toLowerCase();
  if (!value) return null;
  if (["m", "male", "man", "ชาย", "เพศชาย"].includes(value)) return "MALE";
  if (["f", "female", "woman", "หญิง", "เพศหญิง"].includes(value)) return "FEMALE";
  if (["other", "อื่น", "อื่นๆ", "อื่น ๆ"].includes(value)) return "OTHER";
  return "UNKNOWN";
}

function parseLine(line) {
  const match = String(line || "").match(/^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/u);
  if (!match) return null;
  return {
    label: normalizeLabel(match[1]),
    value: toCleanText(match[2]),
  };
}

function isPidLabel(label) {
  return (
    label.includes("เลขที่บัตร") ||
    label.includes("เลขบัตร") ||
    label.includes("บัตรประชาชน") ||
    label.includes("เลขประจำตัวประชาชน")
  );
}

function isFullNameLabel(label) {
  return label === "ชื่อ" || label.includes("ชื่อผู้รับมอบยา") || label.includes("ชื่อสกุล");
}

export function parseDeliverNotes(rawText) {
  const text = String(rawText || "");
  const patient = {
    pid: null,
    fullName: null,
    birthDate: null,
    sex: null,
    cardIssuePlace: null,
    cardIssuedDate: null,
    cardExpiryDate: null,
    addressText: null,
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const row = parseLine(rawLine);
    if (!row || !row.value) continue;

    const { label, value } = row;

    if (isFullNameLabel(label) && !patient.fullName) {
      patient.fullName = value;
      continue;
    }

    if (isPidLabel(label) && !patient.pid) {
      const normalizedPid = value.replace(/\s+/g, "");
      patient.pid = normalizedPid || null;
      continue;
    }

    if (label.includes("วันเกิด") && !patient.birthDate) {
      patient.birthDate = parseDateValue(value);
      continue;
    }

    if (label === "เพศ" && !patient.sex) {
      patient.sex = normalizeSex(value);
      continue;
    }

    if (/ออกบัตร.*วันที่/.test(label) && !patient.cardIssuedDate) {
      patient.cardIssuedDate = parseDateValue(value);
      continue;
    }

    if ((label.startsWith("ออกบัตรที่") || /ออกบัตร.*ที่/.test(label)) && !patient.cardIssuePlace) {
      patient.cardIssuePlace = value;
      continue;
    }

    if (label.includes("หมดอายุ") && !patient.cardExpiryDate) {
      patient.cardExpiryDate = parseDateValue(value);
      continue;
    }

    if (label.startsWith("ที่อยู่") && !patient.addressText) {
      patient.addressText = value;
    }
  }

  return {
    rawText: toCleanText(text) || null,
    patient,
  };
}
