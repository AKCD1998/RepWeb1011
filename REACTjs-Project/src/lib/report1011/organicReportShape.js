function toCleanText(value) {
  return String(value || "").trim();
}

function normalizeOrganicReport(report) {
  const pages = Array.isArray(report?.pages) ? report.pages : [];
  const meta = report?.meta || null;
  const monthKey = toCleanText(
    report?.monthKey || report?.reportMonthKey || meta?.reportMonthKey || meta?.reportMonth || ""
  );
  const monthLabel = toCleanText(
    report?.monthLabel || report?.reportMonthLabel || meta?.reportMonthLabel || ""
  );

  return {
    ...report,
    meta,
    pages,
    monthKey,
    monthLabel,
  };
}

export function normalizeOrganicReportCollection(value) {
  const reportInputs = Array.isArray(value?.reports)
    ? value.reports
    : value && (value?.meta || Array.isArray(value?.pages))
      ? [value]
      : Array.isArray(value)
        ? value
        : [];

  const reports = reportInputs.map(normalizeOrganicReport);
  const meta = value?.meta || reports[0]?.meta || null;
  const pages = Array.isArray(value?.pages) ? value.pages : reports.flatMap((report) => report.pages);

  return {
    ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}),
    meta,
    pages,
    reports,
  };
}

export function getOrganicReportObjects(value) {
  return normalizeOrganicReportCollection(value).reports;
}

export function flattenOrganicReportPages(value) {
  return getOrganicReportObjects(value).flatMap((report) =>
    Array.isArray(report?.pages) ? report.pages : []
  );
}

export function countOrganicReportRows(value) {
  return flattenOrganicReportPages(value).reduce(
    (sum, page) => sum + (Array.isArray(page?.rows) ? page.rows.length : 0),
    0
  );
}

export function countOrganicReportLots(value) {
  return flattenOrganicReportPages(value).length;
}

export function hasOrganicReportPages(value) {
  return flattenOrganicReportPages(value).length > 0;
}

export function formatOrganicReportMonthLabel(value) {
  const text = toCleanText(value);
  const match = text.match(/^(\d{4})-(\d{2})$/);
  if (!match) return text;
  return `${match[2]}/${match[1]}`;
}
