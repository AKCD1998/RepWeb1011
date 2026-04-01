function toCleanText(value) {
  return String(value || "").trim();
}

export function normalizeInlineText(value) {
  return toCleanText(value).replace(/\s+/g, " ");
}

export function formatDisplayNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(3).replace(/\.?0+$/, "");
}

export function getUnitKindFromCode(code) {
  const normalized = normalizeInlineText(code).toUpperCase();
  if (["MG", "MCG", "G"].includes(normalized)) return "MASS";
  if (["ML", "L"].includes(normalized)) return "VOLUME";
  if (["TABLET", "CAPSULE", "TAB", "CAP", "INHALATION"].includes(normalized)) return "COUNT";
  return normalized ? "PACKAGE" : "";
}

export function unitTypeRequiresWholeQuantity(unitTypeCode) {
  const kind = getUnitKindFromCode(unitTypeCode);
  return kind === "COUNT" || kind === "PACKAGE";
}

function compactLeadingCount(text) {
  return normalizeInlineText(text).replace(/^(\d+)\s+/u, "$1");
}

export function parseStructuredUnitLabel(unitLabel) {
  const normalized = normalizeInlineText(unitLabel);
  if (!normalized) return null;

  const parts = normalized
    .split(/\s*[xX×]\s*/u)
    .map((part) => normalizeInlineText(part))
    .filter(Boolean);
  if (parts.length < 2) return null;

  const firstPart = parts[0];
  const containerMatch = firstPart.match(/^1\s+(.+)$/u);
  const containerUnit = normalizeInlineText(containerMatch?.[1] || firstPart);
  if (!containerUnit) return null;

  const compactParts = [compactLeadingCount(firstPart), ...parts.slice(1)];
  return {
    parts,
    containerUnit,
    compactLabel: compactParts.join(" "),
    packDetail: `${parts.slice(1).join(" ")}/${containerUnit}`,
  };
}

export function formatStructuredUnitLabel(unitLabel) {
  const parsed = parseStructuredUnitLabel(unitLabel);
  return parsed?.compactLabel || normalizeInlineText(unitLabel);
}

export function formatQuantityAsUnits(quantity, unitLabel) {
  const qtyText = formatDisplayNumber(quantity);
  if (qtyText === "-") return "-";

  const structuredLabel = formatStructuredUnitLabel(unitLabel);
  if (!structuredLabel) return `${qtyText} หน่วย`;

  return `${qtyText} หน่วย (${structuredLabel})`;
}
