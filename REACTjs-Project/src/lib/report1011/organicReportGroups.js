import { buildBranchProductRequests } from "./organicReportBranches.js";

export const COMBINED_REPORT_GROUP = "KY10_KY11";
export const COMBINED_REPORT_GROUP_LABEL = "ทั้ง 2 แบบ (ขย.10 และ ขย.11)";
const SUPPORTED_REPORT_GROUPS = ["KY10", "KY11"];

export function resolveReportGroupCodes(value) {
  const code = String(value || "").trim().toUpperCase();
  if (code === COMBINED_REPORT_GROUP) return [...SUPPORTED_REPORT_GROUPS];
  return SUPPORTED_REPORT_GROUPS.includes(code) ? [code] : [];
}

export function getProductReportGroupCodes(product) {
  const codes = Array.isArray(product?.reportGroupCodes)
    ? product.reportGroupCodes
    : [product?.reportGroupCode];
  return [...new Set(codes.flatMap(resolveReportGroupCodes))];
}

export function formatReportGroupLabel(code) {
  if (code === "KY10") return "ขย.10";
  if (code === "KY11") return "ขย.11";
  return "";
}

export function buildReportGroupScopes(branchCodes, reportGroupCodes) {
  return branchCodes.flatMap((branchCode) =>
    reportGroupCodes.map((reportGroupCode) => ({ branchCode, reportGroupCode }))
  );
}

export function buildOrganicReportRequests(products, branchCodes, reportGroupCodes) {
  return buildBranchProductRequests(products, branchCodes).flatMap((product) => {
    const productGroups = getProductReportGroupCodes(product);
    return reportGroupCodes
      .filter((code) => productGroups.includes(code))
      .filter((code) =>
        reportGroupCodes.length <= 1 ||
        !Array.isArray(product.activityScopes) ||
        product.activityScopes.some((scope) =>
          scope.branchCode === product.branchCode && scope.reportGroupCode === code
        )
      )
      .map((reportGroupCode) => ({ ...product, reportGroupCode }));
  });
}
