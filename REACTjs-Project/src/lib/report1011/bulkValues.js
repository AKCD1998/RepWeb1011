export function encodeCsv(rows) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return "\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\n");
}

export function normalizeBulkDate(value) {
  const text = String(value ?? "").replace(/^\uFEFF/, "").trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  let year, month, day;
  if (match) [, year, month, day] = match.map(Number);
  else {
    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[\s,].*)?$/);
    if (!match) return "";
    [, day, month, year] = match.map(Number);
  }
  if (year > 2400) year -= 543;
  const date = new Date(year, month - 1, day);
  if (year < 2000 || year > 2100 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
