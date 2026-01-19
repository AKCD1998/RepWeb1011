export const stripBOM = (text) => String(text || "").replace(/^\uFEFF/, "");

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
