function toCleanText(value) {
  return String(value ?? "").trim();
}

function toIsoDate(year, month, day) {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return "";
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeDateOnlyInput(value) {
  const text = toCleanText(value);
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const displayMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (displayMatch) {
    return toIsoDate(
      Number(displayMatch[3]),
      Number(displayMatch[2]),
      Number(displayMatch[1])
    );
  }

  return "";
}

export function formatDateOnlyDisplay(value) {
  const isoDate = normalizeDateOnlyInput(value);
  if (!isoDate) return toCleanText(value);
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}
