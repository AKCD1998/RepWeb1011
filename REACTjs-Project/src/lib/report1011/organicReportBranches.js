export const ALL_REPORT_BRANCHES = "__ALL_BRANCHES__";

function clean(value) {
  return String(value || "").trim();
}

export function getActiveReportBranchCodes(branches) {
  return [...new Set(
    (Array.isArray(branches) ? branches : [])
      .filter((branch) => branch?.is_active !== false && branch?.isActive !== false)
      .map((branch) => clean(branch?.code))
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

export function getAllReportBranchesLabel(branches) {
  const codes = getActiveReportBranchCodes(branches);
  return codes.length ? `ทุกสาขา (${codes.join(",")})` : "";
}

export function resolveReportBranchCodes(branchCode, branches, isAdmin) {
  const code = clean(branchCode);
  if (code === ALL_REPORT_BRANCHES) {
    return isAdmin ? getActiveReportBranchCodes(branches) : [];
  }
  return code ? [code] : [];
}

export function mergeBranchActivityProducts(productLists) {
  const products = new Map();
  for (const list of productLists) {
    for (const product of list) {
      const existing = products.get(product.id);
      if (!existing) {
        products.set(product.id, { ...product });
        continue;
      }
      const reportGroupCodes = [...new Set([
        ...(existing.reportGroupCodes || []),
        ...(product.reportGroupCodes || []),
      ])];
      const activityScopes = [...(existing.activityScopes || []), ...(product.activityScopes || [])];
      if (reportGroupCodes.length) existing.reportGroupCodes = reportGroupCodes;
      if (activityScopes.length) existing.activityScopes = activityScopes;
      for (const field of ["activityCount", "lotCount"]) {
        // A product in both groups can refer to the same dispenses and lots.
        // Without row IDs, their combined count cannot be deduplicated reliably.
        if (reportGroupCodes.length > 1) {
          existing[field] = null;
          continue;
        }
        existing[field] = Number.isFinite(existing[field]) || Number.isFinite(product[field])
          ? (existing[field] || 0) + (product[field] || 0)
          : null;
      }
    }
  }
  return [...products.values()].sort((left, right) => left.label.localeCompare(right.label, "th"));
}

export function buildBranchProductRequests(products, branchCodes) {
  return branchCodes.flatMap((branchCode) =>
    products.map((product) => ({ ...product, branchCode }))
  );
}
