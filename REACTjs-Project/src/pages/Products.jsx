import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalAuth } from "../context/AuthContext";
import { formatDateOnlyDisplay, normalizeDateOnlyInput } from "../lib/dateOnly";
import ProductsStockModal from "../components/products/ProductsStockModal";
import { inventoryApi, productsApi } from "../lib/api";
import { formatDisplayNumber } from "../lib/productUnits";
import "./Products.css";

const EMPTY_INGREDIENT = {
  activeIngredientId: "",
  activeIngredientCode: "",
  nameEn: "",
  nameTh: "",
  useCustomActiveIngredient: false,
  strengthNumerator: "",
  numeratorUnitCode: "",
  useCustomNumeratorUnit: false,
  strengthDenominator: "",
  denominatorUnitCode: "",
  useCustomDenominatorUnit: false,
};

const EMPTY_PACKAGING_LEVEL = {
  id: "",
  displayName: "",
  unitTypeCode: "",
  quantityPerBase: "",
  barcode: "",
  isBase: false,
  isSellable: false,
};

const PACKAGE_SIZE_OPTIONS = [
  "1 กระปุก x 60 เม็ด",
  "1 กล่อง x 100 แผง x 10 เม็ด",
  "1 กล่อง x 10 แผง x 10 เม็ด",
  "1 กล่อง x 1 ขวด x 30 mL",
  "1 กล่อง x 1 ขวด x 60 mL",
  "1 กล่อง x 1 ตลับ x 60 inhalations",
  "1 กล่อง x 1 แผง x 10 เม็ด",
  "1 กล่อง x 1 หลอด x 10 กรัม",
  "1 กล่อง x 1 หลอด x 120 doses",
  "1 กล่อง x 1 หลอด x 120 metered actuations",
  "1 กล่อง x 1 หลอด x 200 metered actuations",
  "1 กล่อง x 20 แผง x 10 เม็ด",
  "1 กล่อง x 25 แผง x 10 เม็ด",
  "1 กล่อง x 25 แผง x 4 เม็ด",
  "1 กล่อง x 3 แผง x 10 เม็ด",
  "1 กล่อง x 50 แผง x 10 เม็ด",
  "1 แผง x 10 เม็ด",
];

const UNIT_TYPE_CODE_OPTIONS = [
  "ACCUHALER",
  "BLISTER",
  "BOTTLE",
  "BOX",
  "MDI",
  "TUBE",
  "TURBUHALER",
];

const DOSAGE_FORM_CODE_OPTIONS = [
  "INHALER",
  "OINTMENT",
  "ORAL_SOLUTION",
  "SOFT_GEL",
  "TABLET",
];
const CUSTOM_GENERIC_VALUE = "__CUSTOM__";
const CUSTOM_ACTIVE_INGREDIENT_VALUE = "__CUSTOM_ACTIVE_INGREDIENT__";
const CUSTOM_NUMERATOR_UNIT_VALUE = "__CUSTOM_NUMERATOR_UNIT__";
const CUSTOM_DENOMINATOR_UNIT_VALUE = "__CUSTOM_DENOMINATOR_UNIT__";
const INGREDIENT_UNIT_CODE_OPTIONS = [
  "MG",
  "MCG",
  "G",
  "ML",
  "L",
  "TABLET",
  "TAB",
  "CAPSULE",
  "CAP",
  "INHALATION",
];
const INGREDIENT_UNIT_CODE_SET = new Set(INGREDIENT_UNIT_CODE_OPTIONS);

function createEmptyIngredient() {
  return { ...EMPTY_INGREDIENT };
}

function createEmptyPackagingLevel(overrides = {}) {
  return { ...EMPTY_PACKAGING_LEVEL, ...overrides };
}

function getIngredientNameKey(value) {
  return String(value || "").trim().toUpperCase();
}

function getUnitCodeKey(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeActiveIngredientOptions(payload) {
  const rows = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  const byId = new Map();

  for (const row of rows) {
    const id = String(row?.id || "").trim();
    const nameEn = String(row?.nameEn ?? row?.name_en ?? "").trim();
    if (!id || !nameEn) continue;
    byId.set(id, {
      id,
      code: String(row?.code || "").trim().toUpperCase(),
      nameEn,
    });
  }

  return [...byId.values()].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
}

function normalizeUnitTypeOptions(payload) {
  const rows = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  const byCode = new Map();

  for (const row of rows) {
    const code = getUnitCodeKey(row?.code);
    if (!code || !INGREDIENT_UNIT_CODE_SET.has(code)) continue;
    byCode.set(code, {
      id: String(row?.id || "").trim(),
      code,
      nameEn: String(row?.nameEn ?? "").trim(),
      unitKind: String(row?.unitKind ?? row?.unit_kind ?? "").trim().toUpperCase(),
      symbol: String(row?.symbol || "").trim(),
    });
  }

  return [...byCode.values()].sort((a, b) => {
    const indexA = INGREDIENT_UNIT_CODE_OPTIONS.indexOf(a.code);
    const indexB = INGREDIENT_UNIT_CODE_OPTIONS.indexOf(b.code);
    return indexA - indexB || a.code.localeCompare(b.code);
  });
}

function createEmptyForm() {
  return {
    productCode: "",
    tradeName: "",
    genericName: "",
    dosageFormCode: "TABLET",
    manufacturerName: "",
    price: "",
    reportGroupCode: "",
    reportReceiveUnitSelectionKey: "",
    noteText: "",
    packagingLevels: [
      createEmptyPackagingLevel({
        quantityPerBase: "1",
        isBase: true,
        isSellable: true,
      }),
    ],
    ingredients: [createEmptyIngredient()],
  };
}

function isIngredientRowBlank(ingredient) {
  return (
    !String(ingredient?.activeIngredientId || "").trim() &&
    !String(ingredient?.activeIngredientCode || "").trim() &&
    !String(ingredient?.nameEn || "").trim() &&
    !String(ingredient?.nameTh || "").trim() &&
    !String(ingredient?.strengthNumerator || "").trim() &&
    !String(ingredient?.numeratorUnitCode || "").trim() &&
    !String(ingredient?.strengthDenominator || "").trim() &&
    !String(ingredient?.denominatorUnitCode || "").trim()
  );
}

function isPackagingLevelRowBlank(level) {
  return (
    !String(level?.id || "").trim() &&
    !String(level?.displayName || "").trim() &&
    !String(level?.unitTypeCode || "").trim() &&
    !String(level?.quantityPerBase || "").trim() &&
    !String(level?.barcode || "").trim()
  );
}

function normalizePackagingLevelForForm(level) {
  return {
    id: String(level?.id || "").trim(),
    displayName: String(level?.displayName ?? level?.packageSize ?? "").trim(),
    unitTypeCode: String(level?.unitTypeCode || "").trim().toUpperCase(),
    quantityPerBase:
      level?.quantityPerBase === null || level?.quantityPerBase === undefined
        ? ""
        : String(level.quantityPerBase),
    barcode: String(level?.barcode || "").trim(),
    isBase: Boolean(level?.isBase),
    isSellable: Boolean(level?.isSellable),
  };
}

function createPackagingLevelsForForm(item) {
  const rows = Array.isArray(item?.packagingLevels)
    ? item.packagingLevels.map(normalizePackagingLevelForForm)
    : [];

  if (rows.length) return rows;

  return [
    createEmptyPackagingLevel({
      displayName: String(item?.packageSize || "").trim(),
      unitTypeCode: String(item?.unitTypeCode || "").trim().toUpperCase(),
      quantityPerBase: "1",
      barcode: String(item?.barcode || "").trim(),
      isBase: true,
      isSellable: true,
    }),
  ];
}

function normalizePackagingLevelQuantityPerBase(level) {
  const numeric = Number(level?.quantityPerBase);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  if (Boolean(level?.isBase)) return 1;
  const matches = [...String(level?.displayName || "").matchAll(/[0-9]+(?:\.[0-9]+)?/g)].map((entry) =>
    Number(entry[0])
  );
  if (matches.length >= 2) return matches[1];
  if (matches.length === 1) return matches[0];
  return 1;
}

function buildPackagingLevelSelectionKey(level) {
  return [
    String(level?.unitTypeCode || "").trim().toUpperCase(),
    String(normalizePackagingLevelQuantityPerBase(level)),
    Boolean(level?.isBase) ? "BASE" : "NON_BASE",
  ].join("|");
}

function extractPackagingContainerLabel(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  const firstPart = normalized.split(/\s*[xX×]\s*/u)[0] || "";
  const containerMatch = firstPart.match(/^1\s+(.+)$/u);
  return String(containerMatch?.[1] || firstPart).trim();
}

function buildReportReceiveUnitOptions(packagingLevels) {
  const levels = Array.isArray(packagingLevels) ? packagingLevels : [];
  const seenKeys = new Set();

  return levels
    .filter((level) => !isPackagingLevelRowBlank(level))
    .map((level) => {
      const key = buildPackagingLevelSelectionKey(level);
      return {
        key,
        fullLabel: String(level?.displayName || "").trim(),
        shortLabel: extractPackagingContainerLabel(level?.displayName) || String(level?.displayName || "").trim(),
        isSellable: Boolean(level?.isSellable),
        isBase: Boolean(level?.isBase),
      };
    })
    .filter((option) => {
      if (!option.key || seenKeys.has(option.key)) return false;
      seenKeys.add(option.key);
      return true;
    });
}

function getDefaultReportReceiveUnitSelectionKey(packagingLevels) {
  const levels = Array.isArray(packagingLevels) ? packagingLevels : [];
  const preferredLevel = levels.find((level) => level.isSellable) || levels.find((level) => level.isBase) || levels[0];
  return preferredLevel ? buildPackagingLevelSelectionKey(preferredLevel) : "";
}

function normalizeIngredientForForm(
  ingredient,
  activeIngredientOptionsByName = new Map(),
  unitTypeOptionsByCode = new Map()
) {
  const nameEn = ingredient?.nameEn || "";
  const activeIngredientIdRaw = String(
    ingredient?.activeIngredientId ?? ingredient?.ingredientId ?? ""
  ).trim();
  const matchedOption =
    !activeIngredientIdRaw && nameEn
      ? activeIngredientOptionsByName.get(getIngredientNameKey(nameEn))
      : null;
  const activeIngredientId = activeIngredientIdRaw || matchedOption?.id || "";
  const numeratorUnitCodeRaw = getUnitCodeKey(ingredient?.numeratorUnitCode);
  const denominatorUnitCodeRaw = getUnitCodeKey(ingredient?.denominatorUnitCode);
  const numeratorUnitOption = numeratorUnitCodeRaw
    ? unitTypeOptionsByCode.get(numeratorUnitCodeRaw)
    : null;
  const denominatorUnitOption = denominatorUnitCodeRaw
    ? unitTypeOptionsByCode.get(denominatorUnitCodeRaw)
    : null;

  return {
    activeIngredientId,
    activeIngredientCode:
      ingredient?.activeIngredientCode || (activeIngredientIdRaw ? "" : matchedOption?.code || ""),
    nameEn: activeIngredientIdRaw ? nameEn : matchedOption?.nameEn || nameEn,
    nameTh: ingredient?.nameTh || "",
    useCustomActiveIngredient: !activeIngredientId && Boolean(nameEn),
    strengthNumerator:
      ingredient?.strengthNumerator === null || ingredient?.strengthNumerator === undefined
        ? ""
        : String(ingredient.strengthNumerator),
    numeratorUnitCode: numeratorUnitOption?.code || numeratorUnitCodeRaw,
    useCustomNumeratorUnit: Boolean(numeratorUnitCodeRaw) && !numeratorUnitOption,
    strengthDenominator:
      ingredient?.strengthDenominator === null || ingredient?.strengthDenominator === undefined
        ? ""
        : String(ingredient.strengthDenominator),
    denominatorUnitCode: denominatorUnitOption?.code || denominatorUnitCodeRaw,
    useCustomDenominatorUnit: Boolean(denominatorUnitCodeRaw) && !denominatorUnitOption,
  };
}

function normalizeApiError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || "Request failed";
}

function normalizeLotWhitelistPayload(payload) {
  const unitLevelRows = Array.isArray(payload?.unitLevels) ? payload.unitLevels : [];
  const lotRows = Array.isArray(payload?.lots) ? payload.lots : [];

  return {
    productId: String(payload?.productId || "").trim(),
    unitLevels: unitLevelRows
      .map((row) => ({
        id: String(row?.id || "").trim(),
        displayName: String(row?.displayName || row?.display_name || row?.code || "-").trim(),
        unitTypeCode: String(row?.unitTypeCode || row?.unit_type_code || "").trim().toUpperCase(),
        isBase: Boolean(row?.isBase ?? row?.is_base),
        isSellable: Boolean(row?.isSellable ?? row?.is_sellable),
      }))
      .filter((row) => row.id),
    lots: lotRows
      .map((row) => ({
        id: String(row?.id || "").trim(),
        lotNo: String(row?.lotNo || row?.lot_no || "").trim(),
        mfgDate: String(row?.mfgDate || row?.mfg_date || "").trim(),
        expDate: String(row?.expDate || row?.exp_date || "").trim(),
        manufacturerName: String(row?.manufacturerName || row?.manufacturer_name || "").trim(),
        hasWhitelist: Boolean(row?.hasWhitelist ?? row?.has_whitelist),
        allowedUnitLevelIds: Array.isArray(row?.allowedUnitLevelIds)
          ? [...new Set(row.allowedUnitLevelIds.map((value) => String(value || "").trim()).filter(Boolean))]
          : [],
        defaultUnitLevelId: String(row?.defaultUnitLevelId || row?.default_unit_level_id || "").trim(),
        invalidUnitLevelIds: Array.isArray(row?.invalidUnitLevelIds)
          ? [...new Set(row.invalidUnitLevelIds.map((value) => String(value || "").trim()).filter(Boolean))]
          : [],
        latestEditReason: String(row?.latestEditReason || row?.latest_edit_reason || "").trim(),
        latestEditedAt: row?.latestEditedAt || row?.latest_edited_at || null,
        latestEditedByName: String(row?.latestEditedByName || row?.latest_edited_by_name || "").trim(),
        latestEditedByUsername: String(
          row?.latestEditedByUsername || row?.latest_edited_by_username || ""
        ).trim(),
      }))
      .filter((row) => row.id),
  };
}

function createLotWhitelistDraft(lot) {
  const allowedUnitLevelIds = Array.isArray(lot?.allowedUnitLevelIds)
    ? [...new Set(lot.allowedUnitLevelIds.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
  const defaultUnitLevelId = String(lot?.defaultUnitLevelId || "").trim();

  return {
    allowedUnitLevelIds,
    defaultUnitLevelId:
      defaultUnitLevelId && allowedUnitLevelIds.includes(defaultUnitLevelId)
        ? defaultUnitLevelId
        : "",
  };
}

function createLotMetadataDraft(lot) {
  return {
    lotNo: String(lot?.lotNo || "").trim(),
    mfgDate: formatDateOnlyDisplay(lot?.mfgDate || ""),
    expDate: formatDateOnlyDisplay(lot?.expDate || ""),
    reason: "",
  };
}

function formatDateTimeDisplay(value) {
  const text = String(value || "").trim();
  if (!text) return "-";

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text.replace("T", " ");
  }

  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function formatProductPrice(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : String(value);
}

function getProductReportGroups(item) {
  return Array.isArray(item?.reportGroupCodes) && item.reportGroupCodes.length
    ? item.reportGroupCodes.join(", ")
    : "-";
}

function getProductExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((item) => ({
    productCode: item?.productCode || "-",
    barcode: item?.barcode || "-",
    tradeName: item?.tradeName || "-",
    manufacturerName: item?.manufacturerName || "-",
    genericName: item?.genericName || "-",
    packaging: item?.packagingSummary || item?.packageSize || "-",
    price: formatProductPrice(item?.price),
    reportGroup: getProductReportGroups(item),
    reportReceiveUnit: item?.reportReceiveUnitShortLabel || item?.reportReceiveUnitLabel || "-",
    dosageFormCode: item?.dosageFormCode || "-",
    status: item?.isActive ? "ใช้งาน" : "ปิดใช้งาน",
  }));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildProductsExcelHtml(rows) {
  const headers = [
    "รหัส",
    "บาร์โค้ด",
    "ชื่อการค้า",
    "ผู้ผลิต/ผู้นำเข้า",
    "ชื่อสามัญ",
    "บรรจุภัณฑ์",
    "ราคา",
    "ชนิดรายงาน",
    "หน่วยรายงานจำนวนที่รับ",
    "รูปแบบยา",
    "สถานะ",
  ];
  const fields = [
    "productCode",
    "barcode",
    "tradeName",
    "manufacturerName",
    "genericName",
    "packaging",
    "price",
    "reportGroup",
    "reportReceiveUnit",
    "dosageFormCode",
    "status",
  ];
  const bodyRows = getProductExportRows(rows)
    .map(
      (row) =>
        `<tr>${fields.map((field) => `<td class="text">${escapeHtml(row[field])}</td>`).join("")}</tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    table { border-collapse: collapse; }
    th, td { border: 1px solid #999; padding: 6px; vertical-align: top; }
    th { background: #e8eef7; font-weight: 700; }
    .text { mso-number-format:"\\@"; }
  </style>
</head>
<body>
  <table>
    <thead>
      <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;
}

function downloadProductsExcel(rows) {
  const dateText = new Date().toISOString().slice(0, 10);
  const blob = new Blob(["\ufeff", buildProductsExcelHtml(rows)], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `products-${dateText}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeLocationRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: String(row?.id || "").trim(),
      code: String(row?.code || "").trim(),
      name: String(row?.name || "").trim(),
      type: String(row?.type || row?.locationType || row?.location_type || "").trim().toUpperCase(),
      isActive: Boolean(row?.isActive ?? row?.is_active ?? true),
    }))
    .filter((row) => row.code && row.type === "BRANCH");
}

function normalizeStockOnHandRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      branchCode: String(row?.branchCode ?? row?.branch_code ?? "").trim(),
      branchName: String(row?.branchName ?? row?.branch_name ?? "").trim(),
      productId: String(row?.productId ?? row?.product_id ?? "").trim(),
      productCode: String(row?.productCode ?? row?.product_code ?? "").trim(),
      tradeName: String(row?.tradeName ?? row?.trade_name ?? "").trim(),
      lotId: String(row?.lotId ?? row?.lot_id ?? "").trim(),
      lotNo: String(row?.lotNo ?? row?.lot_no ?? "").trim(),
      expDate: String(row?.expDate ?? row?.exp_date ?? "").trim(),
      quantity: Number(row?.quantity ?? row?.quantityBase ?? row?.quantity_base ?? 0),
      unitLabel: String(row?.baseUnitLabel ?? row?.base_unit_label ?? row?.unitLabel ?? row?.unit_label ?? "").trim(),
    }))
    .filter((row) => row.productId && Number.isFinite(row.quantity) && row.quantity > 0);
}

function formatStockQuantity(quantity, unitLabel) {
  const qtyText = formatDisplayNumber(quantity);
  if (qtyText === "-") return "-";
  const unit = String(unitLabel || "").trim();
  return unit ? `${qtyText} ${unit}` : qtyText;
}

function buildProductsById(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((product) => {
    const id = String(product?.id || product?.productId || "").trim();
    if (id && !map.has(id)) {
      map.set(id, product);
    }
  });
  return map;
}

function buildBranchStockExportRows(stockRows, productsById) {
  const grouped = new Map();

  normalizeStockOnHandRows(stockRows).forEach((row) => {
    if (!grouped.has(row.productId)) {
      const product = productsById.get(row.productId) || {};
      grouped.set(row.productId, {
        product,
        productId: row.productId,
        productCode: product.productCode || row.productCode || "-",
        barcode: product.barcode || "-",
        tradeName: product.tradeName || row.tradeName || "-",
        manufacturerName: product.manufacturerName || "-",
        genericName: product.genericName || "-",
        packaging: product.packagingSummary || product.packageSize || "-",
        price: formatProductPrice(product.price),
        reportGroup: getProductReportGroups(product),
        reportReceiveUnit: product.reportReceiveUnitShortLabel || product.reportReceiveUnitLabel || "-",
        dosageFormCode: product.dosageFormCode || "-",
        status: product.isActive === false ? "ปิดใช้งาน" : "ใช้งาน",
        totalQuantity: 0,
        unitLabel: row.unitLabel,
        lots: new Map(),
      });
    }

    const productGroup = grouped.get(row.productId);
    productGroup.totalQuantity += row.quantity;
    if (!productGroup.unitLabel && row.unitLabel) {
      productGroup.unitLabel = row.unitLabel;
    }

    const lotKey = row.lotId || `${row.lotNo || "__NO_LOT__"}|${row.expDate || "__NO_EXP__"}`;
    if (!productGroup.lots.has(lotKey)) {
      productGroup.lots.set(lotKey, {
        lotNo: row.lotNo,
        expDate: row.expDate,
        quantity: 0,
        unitLabel: row.unitLabel,
      });
    }

    const lot = productGroup.lots.get(lotKey);
    lot.quantity += row.quantity;
    if (!lot.unitLabel && row.unitLabel) {
      lot.unitLabel = row.unitLabel;
    }
  });

  return [...grouped.values()]
    .map((group) => {
      const lots = [...group.lots.values()].sort((left, right) => {
        const leftExp = left.expDate || "9999-12-31";
        const rightExp = right.expDate || "9999-12-31";
        if (leftExp !== rightExp) return leftExp.localeCompare(rightExp);
        return (left.lotNo || "").localeCompare(right.lotNo || "");
      });

      return {
        ...group,
        totalQuantityText: formatStockQuantity(group.totalQuantity, group.unitLabel),
        lotCount: lots.length,
        lotBreakdown: lots
          .map((lot) => {
            const lotNo = lot.lotNo || "ไม่ระบุ lot";
            const expText = lot.expDate ? ` exp ${formatDateOnlyDisplay(lot.expDate) || lot.expDate}` : "";
            return `${lotNo}${expText}: ${formatStockQuantity(lot.quantity, lot.unitLabel || group.unitLabel)}`;
          })
          .join("\n"),
      };
    })
    .sort((left, right) => {
      if (left.tradeName !== right.tradeName) return left.tradeName.localeCompare(right.tradeName, "th");
      return left.productCode.localeCompare(right.productCode);
    });
}

function buildBranchStockExcelHtml(rows, branchLabel) {
  const headers = [
    "สาขา",
    "รหัส",
    "บาร์โค้ด",
    "ชื่อการค้า",
    "ผู้ผลิต/ผู้นำเข้า",
    "ชื่อสามัญ",
    "บรรจุภัณฑ์",
    "ราคา",
    "ชนิดรายงาน",
    "หน่วยรายงานจำนวนที่รับ",
    "รูปแบบยา",
    "สถานะ",
    "จำนวนรวมในสาขา",
    "จำนวน lot",
    "รายละเอียด lot",
  ];
  const fields = [
    "branchLabel",
    "productCode",
    "barcode",
    "tradeName",
    "manufacturerName",
    "genericName",
    "packaging",
    "price",
    "reportGroup",
    "reportReceiveUnit",
    "dosageFormCode",
    "status",
    "totalQuantityText",
    "lotCount",
    "lotBreakdown",
  ];
  const exportRows = rows.map((row) => ({ ...row, branchLabel }));
  const bodyRows = exportRows
    .map(
      (row) =>
        `<tr>${fields
          .map((field) => `<td class="text">${escapeHtml(row[field]).replace(/\n/g, "<br />")}</td>`)
          .join("")}</tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    table { border-collapse: collapse; }
    th, td { border: 1px solid #999; padding: 6px; vertical-align: top; }
    th { background: #e8eef7; font-weight: 700; }
    .text { mso-number-format:"\\@"; white-space: pre-wrap; }
  </style>
</head>
<body>
  <table>
    <thead>
      <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;
}

function downloadBranchStockExcel(rows, branch) {
  const dateText = new Date().toISOString().slice(0, 10);
  const branchCode = String(branch?.code || "branch").trim();
  const branchLabel = `${branchCode}${branch?.name ? ` ${branch.name}` : ""}`.trim();
  const blob = new Blob(["\ufeff", buildBranchStockExcelHtml(rows, branchLabel)], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `branch-stock-${branchCode}-${dateText}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function Products() {
  const auth = useOptionalAuth();
  const isAdmin = normalizeRole(auth?.user?.role) === "ADMIN";
  const userBranchCode = String(auth?.user?.branchCode || auth?.user?.branch_code || "").trim();
  const [items, setItems] = useState([]);
  const [reportGroups, setReportGroups] = useState([]);
  const [genericNameOptions, setGenericNameOptions] = useState([]);
  const [activeIngredientOptions, setActiveIngredientOptions] = useState([]);
  const [ingredientUnitOptions, setIngredientUnitOptions] = useState([]);
  const [genericSelection, setGenericSelection] = useState("");
  const [customGenericName, setCustomGenericName] = useState("");
  const [isLoadingGenericNames, setIsLoadingGenericNames] = useState(false);
  const [genericNamesError, setGenericNamesError] = useState("");
  const [isLoadingActiveIngredients, setIsLoadingActiveIngredients] = useState(false);
  const [activeIngredientsError, setActiveIngredientsError] = useState("");
  const [isLoadingIngredientUnits, setIsLoadingIngredientUnits] = useState(false);
  const [ingredientUnitsError, setIngredientUnitsError] = useState("");
  const [activeIngredientSearch, setActiveIngredientSearch] = useState("");
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [form, setForm] = useState(createEmptyForm);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [lotWhitelistData, setLotWhitelistData] = useState(() => ({
    productId: "",
    unitLevels: [],
    lots: [],
  }));
  const [selectedLotWhitelistLotId, setSelectedLotWhitelistLotId] = useState("");
  const [lotWhitelistDraft, setLotWhitelistDraft] = useState(() => ({
    allowedUnitLevelIds: [],
    defaultUnitLevelId: "",
  }));
  const [lotMetadataDraft, setLotMetadataDraft] = useState(() =>
    createLotMetadataDraft(null)
  );
  const [isLoadingLotWhitelists, setIsLoadingLotWhitelists] = useState(false);
  const [isSavingLotWhitelist, setIsSavingLotWhitelist] = useState(false);
  const [isSavingLotMetadata, setIsSavingLotMetadata] = useState(false);
  const [lotWhitelistError, setLotWhitelistError] = useState("");
  const [lotWhitelistStatus, setLotWhitelistStatus] = useState("");
  const [lotMetadataError, setLotMetadataError] = useState("");
  const [lotMetadataStatus, setLotMetadataStatus] = useState("");
  const [stockModalProduct, setStockModalProduct] = useState(null);
  const [isBranchExportModalOpen, setIsBranchExportModalOpen] = useState(false);
  const [branchExportOptions, setBranchExportOptions] = useState([]);
  const [selectedBranchExportCode, setSelectedBranchExportCode] = useState("");
  const [isLoadingBranchExportOptions, setIsLoadingBranchExportOptions] = useState(false);
  const [isExportingBranchStock, setIsExportingBranchStock] = useState(false);
  const [branchExportError, setBranchExportError] = useState("");
  const customGenericInputRef = useRef(null);
  const activeIngredientsCacheRef = useRef(new Map());
  const ingredientUnitsCacheRef = useRef(new Map());

  const loadProducts = useCallback(async (searchValue) => {
    setLoading(true);
    setErrorText("");
    try {
      const data = await productsApi.list(searchValue || "");
      setItems(Array.isArray(data) ? data : []);
    } catch (error) {
      setErrorText(normalizeApiError(error));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const resetLotWhitelistState = useCallback(() => {
    setLotWhitelistData({
      productId: "",
      unitLevels: [],
      lots: [],
    });
    setSelectedLotWhitelistLotId("");
    setLotWhitelistDraft({
      allowedUnitLevelIds: [],
      defaultUnitLevelId: "",
    });
    setLotMetadataDraft(createLotMetadataDraft(null));
    setLotWhitelistError("");
    setLotWhitelistStatus("");
    setLotMetadataError("");
    setLotMetadataStatus("");
    setIsLoadingLotWhitelists(false);
    setIsSavingLotWhitelist(false);
    setIsSavingLotMetadata(false);
  }, []);

  const loadLotWhitelists = useCallback(
    async (productId) => {
      const normalizedProductId = String(productId || "").trim();
      if (!normalizedProductId) {
        resetLotWhitelistState();
        return;
      }

      setIsLoadingLotWhitelists(true);
      setLotWhitelistError("");
      setLotWhitelistStatus("");
      try {
        const payload = await productsApi.lotWhitelists(normalizedProductId);
        const normalized = normalizeLotWhitelistPayload(payload);
        setLotWhitelistData(normalized);
        setSelectedLotWhitelistLotId((prev) => {
          const currentId = String(prev || "").trim();
          if (currentId && normalized.lots.some((lot) => lot.id === currentId)) {
            return currentId;
          }
          return normalized.lots[0]?.id || "";
        });
      } catch (error) {
        setLotWhitelistData({
          productId: normalizedProductId,
          unitLevels: [],
          lots: [],
        });
        setSelectedLotWhitelistLotId("");
        setLotWhitelistDraft({
          allowedUnitLevelIds: [],
          defaultUnitLevelId: "",
        });
        setLotWhitelistError(normalizeApiError(error));
      } finally {
        setIsLoadingLotWhitelists(false);
      }
    },
    [resetLotWhitelistState]
  );

  const loadActiveIngredients = useCallback(async (searchValue) => {
    const normalizedSearch = String(searchValue || "").trim();
    const cacheKey = normalizedSearch.toUpperCase();
    const cached = activeIngredientsCacheRef.current.get(cacheKey);
    if (cached) {
      setActiveIngredientOptions(cached);
      setActiveIngredientsError("");
      return;
    }

    setIsLoadingActiveIngredients(true);
    setActiveIngredientsError("");
    try {
      const payload = await productsApi.activeIngredients(normalizedSearch);
      const options = normalizeActiveIngredientOptions(payload);
      activeIngredientsCacheRef.current.set(cacheKey, options);
      setActiveIngredientOptions(options);
    } catch (error) {
      setActiveIngredientOptions([]);
      setActiveIngredientsError(normalizeApiError(error));
    } finally {
      setIsLoadingActiveIngredients(false);
    }
  }, []);

  const loadIngredientUnits = useCallback(async (searchValue = "") => {
    const normalizedSearch = String(searchValue || "").trim();
    const cacheKey = normalizedSearch.toUpperCase();
    const cached = ingredientUnitsCacheRef.current.get(cacheKey);
    if (cached) {
      setIngredientUnitOptions(cached);
      setIngredientUnitsError("");
      return;
    }

    setIsLoadingIngredientUnits(true);
    setIngredientUnitsError("");
    try {
      const payload = await productsApi.unitTypes(normalizedSearch);
      const options = normalizeUnitTypeOptions(payload);
      ingredientUnitsCacheRef.current.set(cacheKey, options);
      setIngredientUnitOptions(options);
    } catch (error) {
      setIngredientUnitOptions([]);
      setIngredientUnitsError(normalizeApiError(error));
    } finally {
      setIsLoadingIngredientUnits(false);
    }
  }, []);

  const syncGenericControls = useCallback(
    (rawGenericName, sourceOptions = genericNameOptions) => {
      const normalized = String(rawGenericName || "").trim().toUpperCase();
      if (!normalized) {
        setGenericSelection("");
        setCustomGenericName("");
        return;
      }

      if (sourceOptions.includes(normalized)) {
        setGenericSelection(normalized);
        setCustomGenericName("");
        return;
      }

      setGenericSelection(CUSTOM_GENERIC_VALUE);
      setCustomGenericName(normalized);
    },
    [genericNameOptions]
  );

  useEffect(() => {
    loadProducts(query);
  }, [loadProducts, query]);

  useEffect(() => {
    let cancelled = false;
    productsApi
      .reportGroups()
      .then((rows) => {
        if (cancelled) return;
        setReportGroups(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (cancelled) return;
        setReportGroups([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingGenericNames(true);
    setGenericNamesError("");

    productsApi
      .genericNames()
      .then((payload) => {
        if (cancelled) return;
        const rawRows = Array.isArray(payload?.generic_names)
          ? payload.generic_names
          : Array.isArray(payload)
            ? payload
            : [];
        const normalizedRows = [...new Set(rawRows.map((value) => String(value || "").trim().toUpperCase()))]
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
        setGenericNameOptions(normalizedRows);
      })
      .catch((error) => {
        if (cancelled) return;
        setGenericNameOptions([]);
        setGenericNamesError(normalizeApiError(error));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingGenericNames(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadActiveIngredients(activeIngredientSearch);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeIngredientSearch, loadActiveIngredients]);

  useEffect(() => {
    loadIngredientUnits("");
  }, [loadIngredientUnits]);

  useEffect(() => {
    if (!isBranchExportModalOpen) return undefined;

    let active = true;
    setIsLoadingBranchExportOptions(true);
    setBranchExportError("");

    inventoryApi
      .listLocations({ includeInactive: false, locationType: "BRANCH" })
      .then((rows) => {
        if (!active) return;
        const normalized = normalizeLocationRows(rows);
        setBranchExportOptions(normalized);
        setSelectedBranchExportCode((current) => {
          if (current && normalized.some((branch) => branch.code === current)) return current;
          if (!isAdmin && userBranchCode && normalized.some((branch) => branch.code === userBranchCode)) {
            return userBranchCode;
          }
          return normalized[0]?.code || "";
        });
      })
      .catch((error) => {
        if (!active) return;
        setBranchExportOptions([]);
        setSelectedBranchExportCode("");
        setBranchExportError(normalizeApiError(error));
      })
      .finally(() => {
        if (active) {
          setIsLoadingBranchExportOptions(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isAdmin, isBranchExportModalOpen, userBranchCode]);

  useEffect(() => {
    syncGenericControls(form.genericName, genericNameOptions);
  }, [genericNameOptions, syncGenericControls]);

  useEffect(() => {
    if (genericSelection !== CUSTOM_GENERIC_VALUE) return;
    customGenericInputRef.current?.focus();
  }, [genericSelection]);

  useEffect(() => {
    if (!editingId) {
      resetLotWhitelistState();
      return;
    }

    void loadLotWhitelists(editingId);
  }, [editingId, loadLotWhitelists, resetLotWhitelistState]);

  const isEditMode = Boolean(editingId);
  const activeIngredientOptionsById = useMemo(
    () => new Map(activeIngredientOptions.map((option) => [option.id, option])),
    [activeIngredientOptions]
  );
  const activeIngredientOptionsByName = useMemo(
    () =>
      new Map(activeIngredientOptions.map((option) => [getIngredientNameKey(option.nameEn), option])),
    [activeIngredientOptions]
  );
  const ingredientUnitOptionsByCode = useMemo(
    () => new Map(ingredientUnitOptions.map((option) => [option.code, option])),
    [ingredientUnitOptions]
  );
  const titleText = useMemo(
    () => (isEditMode ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"),
    [isEditMode]
  );
  const reportGroupOptions = useMemo(() => {
    if (reportGroups.length) return reportGroups;
    return [
      { code: "KY10", thaiName: "บัญชีการขายยาควบคุมพิเศษ (ข.ย.10)" },
      { code: "KY11", thaiName: "บัญชีการขายยาอันตราย (ข.ย.11)" },
    ];
  }, [reportGroups]);
  const unitTypeCodeOptions = useMemo(() => UNIT_TYPE_CODE_OPTIONS, []);
  const packageSizeOptions = useMemo(() => PACKAGE_SIZE_OPTIONS, []);
  const dosageFormCodeOptions = useMemo(() => DOSAGE_FORM_CODE_OPTIONS, []);
  const reportReceiveUnitOptions = useMemo(
    () => buildReportReceiveUnitOptions(form.packagingLevels),
    [form.packagingLevels]
  );
  const isLegacyDosageFormCodeValue = useMemo(() => {
    if (!form.dosageFormCode) return false;
    return !dosageFormCodeOptions.includes(form.dosageFormCode);
  }, [form.dosageFormCode, dosageFormCodeOptions]);
  const genericNameValueForSubmit = useMemo(() => {
    if (genericSelection === CUSTOM_GENERIC_VALUE) {
      return customGenericName.trim();
    }
    return String(genericSelection || "").trim();
  }, [customGenericName, genericSelection]);
  const selectedLotWhitelistLot = useMemo(
    () =>
      lotWhitelistData.lots.find((lot) => lot.id === String(selectedLotWhitelistLotId || "").trim()) ||
      null,
    [lotWhitelistData.lots, selectedLotWhitelistLotId]
  );

  useEffect(() => {
    const fallbackKey = getDefaultReportReceiveUnitSelectionKey(form.packagingLevels);

    setForm((prev) => {
      if (
        prev.reportReceiveUnitSelectionKey &&
        reportReceiveUnitOptions.some((option) => option.key === prev.reportReceiveUnitSelectionKey)
      ) {
        return prev;
      }

      if ((prev.reportReceiveUnitSelectionKey || "") === fallbackKey) {
        return prev;
      }

      return {
        ...prev,
        reportReceiveUnitSelectionKey: fallbackKey,
      };
    });
  }, [form.packagingLevels, reportReceiveUnitOptions]);

  useEffect(() => {
    if (!isEditMode || !activeIngredientOptionsByName.size) return;

    setForm((prev) => {
      let changed = false;
      const nextIngredients = prev.ingredients.map((ingredient) => {
        if (!ingredient.useCustomActiveIngredient || ingredient.activeIngredientId) {
          return ingredient;
        }
        const matched = activeIngredientOptionsByName.get(getIngredientNameKey(ingredient.nameEn));
        if (!matched) return ingredient;
        changed = true;
        return {
          ...ingredient,
          activeIngredientId: matched.id,
          activeIngredientCode: matched.code || ingredient.activeIngredientCode,
          nameEn: matched.nameEn,
          useCustomActiveIngredient: false,
        };
      });

      if (!changed) return prev;
      return { ...prev, ingredients: nextIngredients };
    });
  }, [activeIngredientOptionsByName, isEditMode]);

  useEffect(() => {
    if (!isEditMode || !ingredientUnitOptionsByCode.size) return;

    setForm((prev) => {
      let changed = false;
      const nextIngredients = prev.ingredients.map((ingredient) => {
        let nextIngredient = ingredient;

        if (ingredient.useCustomNumeratorUnit) {
          const numeratorUnitCode = getUnitCodeKey(ingredient.numeratorUnitCode);
          const matchedNumerator = ingredientUnitOptionsByCode.get(numeratorUnitCode);
          if (matchedNumerator) {
            nextIngredient = {
              ...nextIngredient,
              numeratorUnitCode: matchedNumerator.code,
              useCustomNumeratorUnit: false,
            };
            changed = true;
          }
        }

        if (ingredient.useCustomDenominatorUnit) {
          const denominatorUnitCode = getUnitCodeKey(ingredient.denominatorUnitCode);
          const matchedDenominator = ingredientUnitOptionsByCode.get(denominatorUnitCode);
          if (matchedDenominator) {
            nextIngredient = {
              ...nextIngredient,
              denominatorUnitCode: matchedDenominator.code,
              useCustomDenominatorUnit: false,
            };
            changed = true;
          }
        }

        return nextIngredient;
      });

      if (!changed) return prev;
      return { ...prev, ingredients: nextIngredients };
    });
  }, [ingredientUnitOptionsByCode, isEditMode]);

  useEffect(() => {
    setLotWhitelistDraft(createLotWhitelistDraft(selectedLotWhitelistLot));
    setLotWhitelistStatus("");
    setLotWhitelistError("");
    setLotMetadataDraft(createLotMetadataDraft(selectedLotWhitelistLot));
    setLotMetadataStatus("");
    setLotMetadataError("");
  }, [selectedLotWhitelistLot]);

  const handleGenericSelectionChange = (event) => {
    const nextValue = String(event.target.value || "").trim();
    setGenericSelection(nextValue);
    setGenericNamesError("");

    if (nextValue === CUSTOM_GENERIC_VALUE) {
      setCustomGenericName("");
      setForm((prev) => ({ ...prev, genericName: "" }));
      return;
    }

    setCustomGenericName("");
    setForm((prev) => ({ ...prev, genericName: nextValue }));
  };

  const handleCustomGenericNameChange = (event) => {
    const nextValue = String(event.target.value || "").toUpperCase();
    setCustomGenericName(nextValue);
    setForm((prev) => ({ ...prev, genericName: nextValue }));
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setQuery(searchInput.trim());
  };

  const resetForm = () => {
    setForm(createEmptyForm());
    setEditingId("");
    setGenericSelection("");
    setCustomGenericName("");
  };

  const updateIngredientField = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) =>
        currentIndex === index ? { ...ingredient, [field]: value } : ingredient
      ),
    }));
  };

  const getIngredientSelectValue = (ingredient) => {
    if (ingredient.useCustomActiveIngredient) return CUSTOM_ACTIVE_INGREDIENT_VALUE;
    return ingredient.activeIngredientId || "";
  };

  const handleIngredientSelectionChange = (index, selectedValue) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) => {
        if (currentIndex !== index) return ingredient;

        const nextValue = String(selectedValue || "").trim();
        if (nextValue === CUSTOM_ACTIVE_INGREDIENT_VALUE) {
          return {
            ...ingredient,
            activeIngredientId: "",
            activeIngredientCode: "",
            nameEn: "",
            useCustomActiveIngredient: true,
          };
        }

        if (!nextValue) {
          return {
            ...ingredient,
            activeIngredientId: "",
            activeIngredientCode: "",
            nameEn: "",
            useCustomActiveIngredient: false,
          };
        }

        const selectedOption = activeIngredientOptionsById.get(nextValue);
        return {
          ...ingredient,
          activeIngredientId: nextValue,
          activeIngredientCode: selectedOption?.code || "",
          nameEn: selectedOption?.nameEn || ingredient.nameEn,
          useCustomActiveIngredient: false,
        };
      }),
    }));
  };

  const handleCustomIngredientNameChange = (index, value) => {
    const nextValue = String(value || "").toUpperCase();
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) =>
        currentIndex === index
          ? {
              ...ingredient,
              activeIngredientId: "",
              activeIngredientCode: "",
              nameEn: nextValue,
              useCustomActiveIngredient: true,
            }
          : ingredient
      ),
    }));
  };

  const getNumeratorUnitSelectValue = (ingredient) => {
    if (ingredient.useCustomNumeratorUnit) return CUSTOM_NUMERATOR_UNIT_VALUE;
    return getUnitCodeKey(ingredient.numeratorUnitCode);
  };

  const getDenominatorUnitSelectValue = (ingredient) => {
    if (ingredient.useCustomDenominatorUnit) return CUSTOM_DENOMINATOR_UNIT_VALUE;
    return getUnitCodeKey(ingredient.denominatorUnitCode);
  };

  const handleNumeratorUnitSelectionChange = (index, selectedValue) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) => {
        if (currentIndex !== index) return ingredient;

        const nextValue = String(selectedValue || "").trim();
        if (nextValue === CUSTOM_NUMERATOR_UNIT_VALUE) {
          return {
            ...ingredient,
            numeratorUnitCode: "",
            useCustomNumeratorUnit: true,
          };
        }
        if (!nextValue) {
          return {
            ...ingredient,
            numeratorUnitCode: "",
            useCustomNumeratorUnit: false,
          };
        }
        return {
          ...ingredient,
          numeratorUnitCode: getUnitCodeKey(nextValue),
          useCustomNumeratorUnit: false,
        };
      }),
    }));
  };

  const handleDenominatorUnitSelectionChange = (index, selectedValue) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) => {
        if (currentIndex !== index) return ingredient;

        const nextValue = String(selectedValue || "").trim();
        if (nextValue === CUSTOM_DENOMINATOR_UNIT_VALUE) {
          return {
            ...ingredient,
            denominatorUnitCode: "",
            useCustomDenominatorUnit: true,
          };
        }
        if (!nextValue) {
          return {
            ...ingredient,
            denominatorUnitCode: "",
            useCustomDenominatorUnit: false,
          };
        }
        return {
          ...ingredient,
          denominatorUnitCode: getUnitCodeKey(nextValue),
          useCustomDenominatorUnit: false,
        };
      }),
    }));
  };

  const handleCustomNumeratorUnitChange = (index, value) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) =>
        currentIndex === index
          ? {
              ...ingredient,
              numeratorUnitCode: getUnitCodeKey(value),
              useCustomNumeratorUnit: true,
            }
          : ingredient
      ),
    }));
  };

  const handleCustomDenominatorUnitChange = (index, value) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) =>
        currentIndex === index
          ? {
              ...ingredient,
              denominatorUnitCode: getUnitCodeKey(value),
              useCustomDenominatorUnit: true,
            }
          : ingredient
      ),
    }));
  };

  const addIngredientRow = () => {
    setForm((prev) => ({
      ...prev,
      ingredients: [...prev.ingredients, createEmptyIngredient()],
    }));
  };

  const removeIngredientRow = (index) => {
    setForm((prev) => {
      if (prev.ingredients.length <= 1) {
        return {
          ...prev,
          ingredients: [createEmptyIngredient()],
        };
      }

      return {
        ...prev,
        ingredients: prev.ingredients.filter((_, currentIndex) => currentIndex !== index),
      };
    });
  };

  const updatePackagingLevelField = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      packagingLevels: prev.packagingLevels.map((level, currentIndex) =>
        currentIndex === index ? { ...level, [field]: value } : level
      ),
    }));
  };

  const setPackagingLevelExclusiveFlag = (index, field) => {
    setForm((prev) => ({
      ...prev,
      packagingLevels: prev.packagingLevels.map((level, currentIndex) => ({
        ...level,
        [field]: currentIndex === index,
      })),
    }));
  };

  const addPackagingLevelRow = () => {
    setForm((prev) => ({
      ...prev,
      packagingLevels: [...prev.packagingLevels, createEmptyPackagingLevel()],
    }));
  };

  const removePackagingLevelRow = (index) => {
    setForm((prev) => {
      if (prev.packagingLevels.length <= 1) {
        return {
          ...prev,
          packagingLevels: [
            createEmptyPackagingLevel({
              quantityPerBase: "1",
              isBase: true,
              isSellable: true,
            }),
          ],
        };
      }

      const nextPackagingLevels = prev.packagingLevels.filter((_, currentIndex) => currentIndex !== index);
      if (!nextPackagingLevels.some((level) => level.isBase)) {
        nextPackagingLevels[0] = {
          ...nextPackagingLevels[0],
          isBase: true,
          quantityPerBase: "1",
        };
      }
      if (!nextPackagingLevels.some((level) => level.isSellable)) {
        nextPackagingLevels[0] = { ...nextPackagingLevels[0], isSellable: true };
      }

      return {
        ...prev,
        packagingLevels: nextPackagingLevels,
      };
    });
  };

  const handleLotWhitelistUnitToggle = (unitLevelId, checked) => {
    const normalizedUnitLevelId = String(unitLevelId || "").trim();
    if (!normalizedUnitLevelId) return;

    setLotWhitelistDraft((prev) => {
      const nextAllowedUnitLevelIds = checked
        ? [...new Set([...prev.allowedUnitLevelIds, normalizedUnitLevelId])]
        : prev.allowedUnitLevelIds.filter((value) => value !== normalizedUnitLevelId);
      const nextDefaultUnitLevelId = nextAllowedUnitLevelIds.includes(prev.defaultUnitLevelId)
        ? prev.defaultUnitLevelId
        : "";

      return {
        allowedUnitLevelIds: nextAllowedUnitLevelIds,
        defaultUnitLevelId: nextDefaultUnitLevelId,
      };
    });
    setLotWhitelistStatus("");
    setLotWhitelistError("");
  };

  const handleLotWhitelistDefaultChange = (unitLevelId) => {
    const normalizedUnitLevelId = String(unitLevelId || "").trim();
    setLotWhitelistDraft((prev) => ({
      allowedUnitLevelIds: prev.allowedUnitLevelIds.includes(normalizedUnitLevelId)
        ? prev.allowedUnitLevelIds
        : [...prev.allowedUnitLevelIds, normalizedUnitLevelId],
      defaultUnitLevelId: normalizedUnitLevelId,
    }));
    setLotWhitelistStatus("");
    setLotWhitelistError("");
  };

  const handleLotWhitelistReset = () => {
    setLotWhitelistDraft(createLotWhitelistDraft(selectedLotWhitelistLot));
    setLotWhitelistStatus("");
    setLotWhitelistError("");
  };

  const handleLotWhitelistSave = async () => {
    if (!editingId) {
      setLotWhitelistError("กรุณาเลือกสินค้าแบบแก้ไขก่อนจัดการ lot whitelist");
      return;
    }
    if (!selectedLotWhitelistLot?.id) {
      setLotWhitelistError("กรุณาเลือก lot ที่ต้องการจัดการ");
      return;
    }

    setIsSavingLotWhitelist(true);
    setLotWhitelistError("");
    setLotWhitelistStatus("");
    try {
      await productsApi.updateLotWhitelist(editingId, selectedLotWhitelistLot.id, {
        allowedUnitLevelIds: lotWhitelistDraft.allowedUnitLevelIds,
        defaultUnitLevelId: lotWhitelistDraft.defaultUnitLevelId,
      });
      await loadLotWhitelists(editingId);
      setLotWhitelistStatus("บันทึก lot whitelist แล้ว");
    } catch (error) {
      setLotWhitelistError(normalizeApiError(error));
    } finally {
      setIsSavingLotWhitelist(false);
    }
  };

  const handleLotMetadataFieldChange = (field, value) => {
    setLotMetadataDraft((prev) => ({
      ...prev,
      [field]: value,
    }));
    setLotMetadataError("");
    setLotMetadataStatus("");
  };

  const handleLotMetadataReset = () => {
    setLotMetadataDraft(createLotMetadataDraft(selectedLotWhitelistLot));
    setLotMetadataError("");
    setLotMetadataStatus("");
  };

  const handleLotMetadataSave = async () => {
    if (!editingId) {
      setLotMetadataError("กรุณาเลือกสินค้าแบบแก้ไขก่อนจัดการ lot metadata");
      return;
    }
    if (!selectedLotWhitelistLot?.id) {
      setLotMetadataError("กรุณาเลือก lot ที่ต้องการแก้ไข");
      return;
    }
    if (!lotMetadataDraft.lotNo.trim()) {
      setLotMetadataError("กรุณาระบุ lot number");
      return;
    }
    if (!normalizeDateOnlyInput(lotMetadataDraft.expDate)) {
      setLotMetadataError("กรุณาระบุวันหมดอายุเป็น dd/mm/yyyy");
      return;
    }
    if (lotMetadataDraft.mfgDate && !normalizeDateOnlyInput(lotMetadataDraft.mfgDate)) {
      setLotMetadataError("วันผลิตต้องอยู่ในรูปแบบ dd/mm/yyyy");
      return;
    }
    if (!lotMetadataDraft.reason.trim()) {
      setLotMetadataError("กรุณากรอกเหตุผล/incident report สำหรับการแก้ไข lot");
      return;
    }

    setIsSavingLotMetadata(true);
    setLotMetadataError("");
    setLotMetadataStatus("");
    try {
      await productsApi.updateLotMetadata(editingId, selectedLotWhitelistLot.id, {
        lotNo: lotMetadataDraft.lotNo,
        mfgDate: lotMetadataDraft.mfgDate,
        expDate: lotMetadataDraft.expDate,
        reason: lotMetadataDraft.reason,
      });
      await loadLotWhitelists(editingId);
      setLotMetadataStatus("บันทึกการแก้ไข lot metadata แล้ว");
    } catch (error) {
      setLotMetadataError(normalizeApiError(error));
    } finally {
      setIsSavingLotMetadata(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setErrorText("");
    setStatusText("");

    try {
      const ingredientsPayload = form.ingredients
        .map((ingredient) => ({
          activeIngredientId: ingredient.activeIngredientId.trim() || null,
          activeIngredientCode: ingredient.activeIngredientCode.trim() || null,
          nameEn: ingredient.nameEn.trim() || null,
          nameTh: ingredient.nameTh.trim() || null,
          strengthNumerator: ingredient.strengthNumerator,
          numeratorUnitCode: ingredient.numeratorUnitCode.trim() || null,
          strengthDenominator: ingredient.strengthDenominator,
          denominatorUnitCode: ingredient.denominatorUnitCode.trim() || null,
        }))
        .filter((ingredient) => !isIngredientRowBlank(ingredient));
      const packagingLevelsPayload = form.packagingLevels
        .filter((level) => !isPackagingLevelRowBlank(level))
        .map((level) => ({
          id: level.id || undefined,
          displayName: level.displayName.trim(),
          unitTypeCode: level.unitTypeCode.trim().toUpperCase(),
          quantityPerBase: level.quantityPerBase === "" ? null : level.quantityPerBase,
          barcode: level.barcode.trim() || null,
          isBase: Boolean(level.isBase),
          isSellable: Boolean(level.isSellable),
        }));
      const basePackagingCount = packagingLevelsPayload.filter((level) => level.isBase).length;
      const sellablePackagingCount = packagingLevelsPayload.filter((level) => level.isSellable).length;

      if (!packagingLevelsPayload.length) {
        throw new Error("ต้องมี packaging level อย่างน้อย 1 รายการ");
      }
      if (basePackagingCount !== 1) {
        throw new Error("ต้องเลือกหน่วยฐานให้สินค้า 1 รายการ");
      }
      if (sellablePackagingCount !== 1) {
        throw new Error("ต้องเลือกหน่วยขายหลักให้สินค้า 1 รายการ");
      }
      const primaryPackagingLevel =
        packagingLevelsPayload.find((level) => level.isSellable) || packagingLevelsPayload[0] || null;

      const payload = {
        productCode: form.productCode || null,
        barcode: primaryPackagingLevel?.barcode || null,
        tradeName: form.tradeName,
        genericName: genericNameValueForSubmit || null,
        dosageFormCode: form.dosageFormCode || "TABLET",
        manufacturerName: form.manufacturerName || null,
        packageSize: primaryPackagingLevel?.displayName || null,
        unitTypeCode: primaryPackagingLevel?.unitTypeCode || null,
        price: form.price === "" ? null : form.price,
        reportGroupCodes: form.reportGroupCode ? [form.reportGroupCode] : [],
        reportReceiveUnitKey: form.reportReceiveUnitSelectionKey || null,
        noteText: form.noteText || null,
        packagingLevels: packagingLevelsPayload,
        ingredients: ingredientsPayload,
      };

      if (isEditMode) {
        await productsApi.update(editingId, payload);
        setStatusText("อัปเดตรายการสินค้าแล้ว");
      } else {
        await productsApi.create(payload);
        setStatusText("เพิ่มรายการสินค้าแล้ว");
      }

      resetForm();
      await loadProducts(query);
    } catch (error) {
      setErrorText(normalizeApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const handleCloseStockModal = useCallback(() => {
    setStockModalProduct(null);
  }, []);

  const handleOpenStockModal = useCallback((item) => {
    const nextProduct = item && typeof item === "object" ? item : null;
    if (!String(nextProduct?.id || "").trim()) return;
    setStockModalProduct(nextProduct);
  }, []);

  const handleEditClick = (item) => {
    const ingredientRows =
      Array.isArray(item.ingredients) && item.ingredients.length
        ? item.ingredients.map((ingredient) =>
            normalizeIngredientForForm(
              ingredient,
              activeIngredientOptionsByName,
              ingredientUnitOptionsByCode
            )
          )
        : [createEmptyIngredient()];
    const packagingLevels = createPackagingLevelsForForm(item);

    setEditingId(item.id);
    setForm({
      productCode: item.productCode || "",
      tradeName: item.tradeName || "",
      genericName: item.genericName || "",
      dosageFormCode: item.dosageFormCode || "TABLET",
      manufacturerName: item.manufacturerName || "",
      price: item.price === null || item.price === undefined ? "" : String(item.price),
      reportGroupCode: Array.isArray(item.reportGroupCodes) ? item.reportGroupCodes[0] || "" : "",
      reportReceiveUnitSelectionKey:
        String(item.reportReceiveUnitKey || "").trim() ||
        getDefaultReportReceiveUnitSelectionKey(packagingLevels),
      noteText: item.noteText || "",
      packagingLevels,
      ingredients: ingredientRows,
    });
    syncGenericControls(item.genericName || "");
    setStatusText("");
  };

  const handleDeleteClick = async (item) => {
    const ok = window.confirm(`ลบสินค้า "${item.tradeName}" ?`);
    if (!ok) return;
    setErrorText("");
    setStatusText("");
    try {
      await productsApi.remove(item.id);
      setStatusText("ลบสินค้าแล้ว (soft delete)");
      await loadProducts(query);
      if (editingId === item.id) {
        resetForm();
      }
    } catch (error) {
      setErrorText(normalizeApiError(error));
    }
  };

  const handleExportProducts = () => {
    if (!items.length) {
      setErrorText("ไม่มีข้อมูลสินค้าให้ export");
      return;
    }

    setErrorText("");
    downloadProductsExcel(items);
    setStatusText(`Export ข้อมูลยา ${items.length} รายการแล้ว`);
  };

  const handleOpenBranchExportModal = () => {
    setErrorText("");
    setStatusText("");
    setBranchExportError("");
    setIsBranchExportModalOpen(true);
  };

  const handleCloseBranchExportModal = () => {
    if (isExportingBranchStock) return;
    setIsBranchExportModalOpen(false);
    setBranchExportError("");
  };

  const handleBranchExportBackdrop = (event) => {
    if (event.target === event.currentTarget) {
      handleCloseBranchExportModal();
    }
  };

  const handleExportBranchStock = async () => {
    const branch = branchExportOptions.find((option) => option.code === selectedBranchExportCode);
    if (!branch) {
      setBranchExportError("กรุณาเลือกสาขาก่อนส่งออกข้อมูล");
      return;
    }

    setIsExportingBranchStock(true);
    setBranchExportError("");
    setErrorText("");
    setStatusText("");

    try {
      const [stockRows, allProducts] = await Promise.all([
        inventoryApi.listStockOnHand({ branchCode: branch.code }),
        productsApi.list(""),
      ]);
      const productsById = buildProductsById([...items, ...(Array.isArray(allProducts) ? allProducts : [])]);
      const exportRows = buildBranchStockExportRows(stockRows, productsById);

      if (!exportRows.length) {
        setBranchExportError("สาขานี้ไม่มีสินค้าที่ stock มากกว่า 0");
        return;
      }

      downloadBranchStockExcel(exportRows, branch);
      setStatusText(`Export stock สาขา ${branch.code} จำนวน ${exportRows.length} รายการแล้ว`);
      setIsBranchExportModalOpen(false);
    } catch (error) {
      setBranchExportError(normalizeApiError(error));
    } finally {
      setIsExportingBranchStock(false);
    }
  };

  return (
    <section className="products-page page-placeholder">
      <div className="products-header">
        <h1>จัดการสินค้า</h1>
        <p>CRUD สินค้าผ่าน backend API พร้อมค้นหา/เพิ่ม/แก้ไข/ปิดใช้งาน</p>
      </div>

      <form className="products-search" onSubmit={handleSearchSubmit}>
        <input
          type="text"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="ค้นหาจากชื่อการค้า / ชื่อสามัญ / รหัสสินค้า"
          aria-label="ค้นหาสินค้า"
        />
        <button type="submit" className="products-btn">
          ค้นหา
        </button>
      </form>

      <form className="products-form" onSubmit={handleSubmit}>
        <div className="products-form-title">{titleText}</div>
        <div className="products-grid">
          <label>
            รหัสสินค้า
            <input
              type="text"
              value={form.productCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, productCode: event.target.value }))
              }
            />
          </label>
          <label>
            ชื่อการค้า*
            <input
              type="text"
              required
              value={form.tradeName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, tradeName: event.target.value }))
              }
            />
          </label>
          <label>
            ผู้ผลิต/ผู้นำเข้า
            <input
              type="text"
              value={form.manufacturerName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, manufacturerName: event.target.value }))
              }
            />
          </label>
          <label className="products-generic-field">
            ชื่อสามัญ (สรุป)
            <select
              value={genericSelection}
              onChange={handleGenericSelectionChange}
              disabled={isLoadingGenericNames}
            >
              <option value="">เลือกชื่อสามัญ (สรุป)</option>
              {genericNameOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value={CUSTOM_GENERIC_VALUE}>กำหนดเอง (กรณีสูตรยาใหม่)</option>
            </select>
            {genericSelection === CUSTOM_GENERIC_VALUE ? (
              <input
                ref={customGenericInputRef}
                type="text"
                className="products-generic-custom-input"
                value={customGenericName}
                onChange={handleCustomGenericNameChange}
                placeholder="ระบุชื่อสามัญใหม่"
              />
            ) : null}
            {isLoadingGenericNames ? (
              <small className="products-generic-help">กำลังโหลดรายการชื่อสามัญ...</small>
            ) : null}
            {genericNamesError ? (
              <small className="products-generic-help products-generic-help--error">
                โหลดรายการชื่อสามัญไม่สำเร็จ สามารถเลือกกำหนดเองได้
              </small>
            ) : null}
          </label>
          <label>
            Dosage Form Code
            <select
              value={form.dosageFormCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, dosageFormCode: event.target.value }))
              }
            >
              <option value="">เลือก Dosage Form Code</option>
              {isLegacyDosageFormCodeValue ? (
                <option value={form.dosageFormCode}>{`${form.dosageFormCode} (legacy)`}</option>
              ) : null}
              {dosageFormCodeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            ราคาขายต่อหน่วย
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
            />
          </label>
          <label>
            ชนิดรายงาน (ข.ย.)
            <select
              value={form.reportGroupCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, reportGroupCode: event.target.value }))
              }
            >
              <option value="">ไม่ระบุ</option>
              {reportGroupOptions.map((group) => (
                <option key={group.code} value={group.code}>
                  {group.code}
                  {group.thaiName ? ` - ${group.thaiName}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="products-report-unit-field">
            หน่วยรายงานสำหรับ "จำนวนที่รับ"
            <select
              value={form.reportReceiveUnitSelectionKey}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  reportReceiveUnitSelectionKey: event.target.value,
                }))
              }
              disabled={!reportReceiveUnitOptions.length}
            >
              {reportReceiveUnitOptions.length ? (
                reportReceiveUnitOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {`${option.shortLabel} : ${option.fullLabel}`}
                    {option.isSellable ? " [ขาย]" : ""}
                    {option.isBase ? " [ฐาน]" : ""}
                  </option>
                ))
              ) : (
                <option value="">เพิ่ม packaging level ก่อน</option>
              )}
            </select>
            <small className="products-generic-help">
              ใช้กับ Card B ในหน้า Reports เฉพาะช่อง "จำนวนที่รับ" เพื่อให้ระบบแปลง qty ไปหน่วยที่เลือก
            </small>
          </label>
          <div className="products-packaging">
            <div className="products-packaging-header">
              <strong>Packaging Levels</strong>
              <button
                type="button"
                className="products-btn small secondary"
                onClick={addPackagingLevelRow}
              >
                เพิ่ม packaging level
              </button>
            </div>
            <div className="products-packaging-legend">
              <span>ชื่อบรรจุภัณฑ์</span>
              <span>Unit Type</span>
              <span>จำนวนหน่วยฐาน</span>
              <span>บาร์โค้ด</span>
              <span>ฐาน</span>
              <span>ขาย</span>
              <span>จัดการ</span>
            </div>
            {form.packagingLevels.map((level, index) => {
              const hasLegacyUnitTypeCode =
                Boolean(level.unitTypeCode) && !unitTypeCodeOptions.includes(level.unitTypeCode);

              return (
                <div className="products-packaging-row" key={level.id || `packaging-${index}`}>
                  <input
                    type="text"
                    list="products-package-size-options"
                    placeholder="เช่น 1 แผง x 10 เม็ด"
                    value={level.displayName}
                    onChange={(event) =>
                      updatePackagingLevelField(index, "displayName", event.target.value)
                    }
                  />
                  <select
                    value={level.unitTypeCode}
                    onChange={(event) =>
                      updatePackagingLevelField(index, "unitTypeCode", event.target.value)
                    }
                  >
                    <option value="">เลือก Unit Type</option>
                    {hasLegacyUnitTypeCode ? (
                      <option value={level.unitTypeCode}>{`${level.unitTypeCode} (legacy)`}</option>
                    ) : null}
                    {unitTypeCodeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    placeholder="เช่น 3"
                    value={level.quantityPerBase}
                    disabled={level.isBase}
                    onChange={(event) =>
                      updatePackagingLevelField(index, "quantityPerBase", event.target.value)
                    }
                  />
                  <input
                    type="text"
                    placeholder="barcode (optional)"
                    value={level.barcode}
                    onChange={(event) =>
                      updatePackagingLevelField(index, "barcode", event.target.value)
                    }
                  />
                  <label className="products-packaging-flag">
                    <input
                      type="radio"
                      name="products-base-packaging"
                      checked={level.isBase}
                      onChange={() => {
                        setPackagingLevelExclusiveFlag(index, "isBase");
                        updatePackagingLevelField(index, "quantityPerBase", "1");
                      }}
                    />
                    ฐาน
                  </label>
                  <label className="products-packaging-flag">
                    <input
                      type="radio"
                      name="products-sellable-packaging"
                      checked={level.isSellable}
                      onChange={() => setPackagingLevelExclusiveFlag(index, "isSellable")}
                    />
                    ขาย
                  </label>
                  <button
                    type="button"
                    className="products-btn small danger"
                    onClick={() => removePackagingLevelRow(index)}
                  >
                    ลบ
                  </button>
                </div>
              );
            })}
            <datalist id="products-package-size-options">
              {packageSizeOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
            <p className="products-ingredient-hint">
              `จำนวนหน่วยฐาน` คือจำนวนของหน่วยเล็กสุดต่อ 1 packaging level นี้ เช่น กล่อง 3 แผง ให้ใส่
              `3` ถ้าหน่วยฐานคือแผง
            </p>
          </div>
          <div className="products-ingredients">
            <div className="products-ingredients-header">
              <strong>ตัวยาสำคัญ (สูตรผสม)</strong>
              <button type="button" className="products-btn small secondary" onClick={addIngredientRow}>
                เพิ่มตัวยา
              </button>
            </div>
            <input
              type="text"
              className="products-ingredient-search"
              value={activeIngredientSearch}
              onChange={(event) => setActiveIngredientSearch(event.target.value)}
              placeholder="ค้นหาสารสำคัญ (EN / code)"
            />
            {isLoadingActiveIngredients ? (
              <p className="products-ingredient-help">กำลังโหลดรายการสารสำคัญ...</p>
            ) : null}
            {activeIngredientsError ? (
              <p className="products-ingredient-help products-ingredient-help--error">
                โหลดรายการสารสำคัญไม่สำเร็จ สามารถเลือกกำหนดเองได้
              </p>
            ) : null}
            {isLoadingIngredientUnits ? (
              <p className="products-ingredient-help">กำลังโหลดรายการหน่วย...</p>
            ) : null}
            {ingredientUnitsError ? (
              <p className="products-ingredient-help products-ingredient-help--error">
                โหลดรายการหน่วยไม่สำเร็จ สามารถกำหนดเองได้
              </p>
            ) : null}
            {form.ingredients.map((ingredient, index) => {
              const hasMissingSelectedOption =
                Boolean(ingredient.activeIngredientId) &&
                !activeIngredientOptionsById.has(ingredient.activeIngredientId);
              const numeratorUnitCode = getUnitCodeKey(ingredient.numeratorUnitCode);
              const denominatorUnitCode = getUnitCodeKey(ingredient.denominatorUnitCode);
              const hasMissingNumeratorOption =
                Boolean(numeratorUnitCode) && !ingredientUnitOptionsByCode.has(numeratorUnitCode);
              const hasMissingDenominatorOption =
                Boolean(denominatorUnitCode) &&
                !ingredientUnitOptionsByCode.has(denominatorUnitCode);

              return (
                <div className="products-ingredient-row" key={`ingredient-${index}`}>
                  <div className="products-ingredient-name-field">
                    <select
                      value={getIngredientSelectValue(ingredient)}
                      onChange={(event) => handleIngredientSelectionChange(index, event.target.value)}
                      disabled={isLoadingActiveIngredients}
                    >
                      <option value="">เลือกสารสำคัญ (EN) *</option>
                      {hasMissingSelectedOption ? (
                        <option value={ingredient.activeIngredientId}>
                          {ingredient.nameEn || ingredient.activeIngredientCode || "(legacy)"}
                        </option>
                      ) : null}
                      {activeIngredientOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.nameEn}
                        </option>
                      ))}
                      <option value={CUSTOM_ACTIVE_INGREDIENT_VALUE}>
                        กำหนดเอง (กรณีตัวยาใหม่)
                      </option>
                    </select>
                    {ingredient.useCustomActiveIngredient ? (
                      <input
                        type="text"
                        placeholder="ชื่อสารสำคัญใหม่ (EN) *"
                        value={ingredient.nameEn}
                        onChange={(event) =>
                          handleCustomIngredientNameChange(index, event.target.value)
                        }
                      />
                    ) : null}
                  </div>
                  <input
                    type="text"
                    placeholder="ความแรง"
                    value={ingredient.strengthNumerator}
                    onChange={(event) =>
                      updateIngredientField(index, "strengthNumerator", event.target.value)
                    }
                  />
                  <div className="products-ingredient-unit-field">
                    <select
                      value={getNumeratorUnitSelectValue(ingredient)}
                      onChange={(event) =>
                        handleNumeratorUnitSelectionChange(index, event.target.value)
                      }
                      disabled={isLoadingIngredientUnits}
                    >
                      <option value="">หน่วยตัวตั้ง (เช่น MG)</option>
                      {hasMissingNumeratorOption ? (
                        <option value={numeratorUnitCode}>{numeratorUnitCode}</option>
                      ) : null}
                      {ingredientUnitOptions.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.code}
                          {option.symbol ? ` (${option.symbol})` : ""}
                        </option>
                      ))}
                      <option value={CUSTOM_NUMERATOR_UNIT_VALUE}>กำหนดเอง</option>
                    </select>
                    {ingredient.useCustomNumeratorUnit ? (
                      <input
                        type="text"
                        placeholder="ระบุหน่วยตัวตั้ง (เช่น MG)"
                        value={ingredient.numeratorUnitCode}
                        onChange={(event) =>
                          handleCustomNumeratorUnitChange(index, event.target.value)
                        }
                      />
                    ) : null}
                  </div>
                  <input
                    type="text"
                    placeholder="ตัวหาร (ถ้ามี)"
                    value={ingredient.strengthDenominator}
                    onChange={(event) =>
                      updateIngredientField(index, "strengthDenominator", event.target.value)
                    }
                  />
                  <div className="products-ingredient-unit-field">
                    <select
                      value={getDenominatorUnitSelectValue(ingredient)}
                      onChange={(event) =>
                        handleDenominatorUnitSelectionChange(index, event.target.value)
                      }
                      disabled={isLoadingIngredientUnits}
                    >
                      <option value="">หน่วยตัวหาร (เช่น ML)</option>
                      {hasMissingDenominatorOption ? (
                        <option value={denominatorUnitCode}>{denominatorUnitCode}</option>
                      ) : null}
                      {ingredientUnitOptions.map((option) => (
                        <option key={`${option.code}-den`} value={option.code}>
                          {option.code}
                          {option.symbol ? ` (${option.symbol})` : ""}
                        </option>
                      ))}
                      <option value={CUSTOM_DENOMINATOR_UNIT_VALUE}>กำหนดเอง</option>
                    </select>
                    {ingredient.useCustomDenominatorUnit ? (
                      <input
                        type="text"
                        placeholder="ระบุหน่วยตัวหาร (เช่น ML)"
                        value={ingredient.denominatorUnitCode}
                        onChange={(event) =>
                          handleCustomDenominatorUnitChange(index, event.target.value)
                        }
                      />
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="products-btn small danger"
                    onClick={() => removeIngredientRow(index)}
                  >
                    ลบ
                  </button>
                </div>
              );
            })}
            <p className="products-ingredient-hint">
              ตัวอย่าง: Paracetamol 500 MG, หรือ Amoxicillin 125 MG / 5 ML
            </p>
          </div>
          <label className="products-note">
            หมายเหตุ
            <textarea
              rows={2}
              value={form.noteText}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, noteText: event.target.value }))
              }
            />
          </label>
        </div>
        <div className="products-actions">
          <button type="submit" className="products-btn" disabled={saving}>
            {saving ? "กำลังบันทึก..." : isEditMode ? "อัปเดตสินค้า" : "เพิ่มสินค้า"}
          </button>
          <button
            type="button"
            className="products-btn secondary"
            onClick={resetForm}
            disabled={saving}
          >
            ล้างฟอร์ม
          </button>
        </div>
      </form>

      {isEditMode ? (
        <section className="products-lot-whitelist">
          <div className="products-lot-whitelist__header">
            <div>
              <h2>Lot-Specific Whitelist</h2>
              <p>ส่วนนี้แยกจาก Packaging Levels ของสินค้า และใช้กับ lot ที่บันทึกแล้วเท่านั้น</p>
            </div>
          </div>

          {isLoadingLotWhitelists ? (
            <div className="products-lot-whitelist__empty">กำลังโหลด lot และ whitelist...</div>
          ) : lotWhitelistError ? (
            <div className="products-alert error">{lotWhitelistError}</div>
          ) : !lotWhitelistData.lots.length ? (
            <div className="products-lot-whitelist__empty">
              สินค้านี้ยังไม่มี lot ที่บันทึกในระบบ จึงยังไม่มี whitelist ให้จัดการ
            </div>
          ) : (
            <>
              <div className="products-lot-whitelist__toolbar">
                <label>
                  เลือก lot
                  <select
                    value={selectedLotWhitelistLotId}
                    onChange={(event) => setSelectedLotWhitelistLotId(event.target.value)}
                    disabled={isSavingLotWhitelist || isSavingLotMetadata}
                  >
                    {lotWhitelistData.lots.map((lot) => (
                      <option key={lot.id} value={lot.id}>
                        {`${lot.lotNo || "-"} • exp ${formatDateOnlyDisplay(lot.expDate) || "-"}${
                          lot.hasWhitelist ? " • มี whitelist" : " • fallback"
                        }`}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="products-lot-whitelist__meta">
                  <span>ใช้ packaging levels ที่บันทึกแล้วของสินค้าเท่านั้น</span>
                  <span>ถ้าบันทึกแบบว่าง ระบบจะกลับไป fallback ระดับสินค้า</span>
                </div>
              </div>

              {selectedLotWhitelistLot ? (
                <div className="products-lot-whitelist__body">
                  <div className="products-lot-whitelist__summary">
                    <div>
                      <strong>Lot</strong>
                      <div>{selectedLotWhitelistLot.lotNo || "-"}</div>
                    </div>
                    <div>
                      <strong>MFG</strong>
                      <div>{formatDateOnlyDisplay(selectedLotWhitelistLot.mfgDate) || "-"}</div>
                    </div>
                    <div>
                      <strong>Exp</strong>
                      <div>{formatDateOnlyDisplay(selectedLotWhitelistLot.expDate) || "-"}</div>
                    </div>
                    <div>
                      <strong>สถานะ</strong>
                      <div>
                        {selectedLotWhitelistLot.hasWhitelist
                          ? "มี lot whitelist"
                          : "ยังใช้ fallback ระดับสินค้า"}
                      </div>
                    </div>
                  </div>

                  <div className="products-lot-metadata">
                    <div className="products-lot-metadata__header">
                      <div>
                        <h3>Lot Metadata Edit Mode</h3>
                        <p>
                          แก้เลข lot / วันผลิต / วันหมดอายุ พร้อมบันทึกเหตุผลแบบ incident report
                        </p>
                      </div>
                      <div className="products-lot-metadata__latest">
                        <strong>แก้ไขล่าสุด</strong>
                        <span>
                          {selectedLotWhitelistLot.latestEditedAt
                            ? `${formatDateTimeDisplay(
                                selectedLotWhitelistLot.latestEditedAt
                              )} โดย ${
                                selectedLotWhitelistLot.latestEditedByName ||
                                selectedLotWhitelistLot.latestEditedByUsername ||
                                "-"
                              }`
                            : "ยังไม่มีประวัติการแก้ไข lot นี้"}
                        </span>
                      </div>
                    </div>

                    <div className="products-lot-metadata__grid">
                      <label>
                        เลข lot
                        <input
                          type="text"
                          value={lotMetadataDraft.lotNo}
                          onChange={(event) =>
                            handleLotMetadataFieldChange("lotNo", event.target.value)
                          }
                          disabled={isSavingLotMetadata}
                        />
                      </label>
                      <label>
                        วันผลิต (dd/mm/yyyy)
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="เช่น 07/04/2026"
                          value={lotMetadataDraft.mfgDate}
                          onChange={(event) =>
                            handleLotMetadataFieldChange("mfgDate", event.target.value)
                          }
                          disabled={isSavingLotMetadata}
                        />
                      </label>
                      <label>
                        วันหมดอายุ (dd/mm/yyyy)
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="เช่น 07/04/2027"
                          value={lotMetadataDraft.expDate}
                          onChange={(event) =>
                            handleLotMetadataFieldChange("expDate", event.target.value)
                          }
                          disabled={isSavingLotMetadata}
                        />
                      </label>
                    </div>

                    <label className="products-lot-metadata__reason">
                      เหตุผล / Incident Report
                      <textarea
                        rows={3}
                        placeholder="อธิบายว่าแก้อะไร เพราะอะไร และพบความคลาดเคลื่อนจากจุดใด"
                        value={lotMetadataDraft.reason}
                        onChange={(event) =>
                          handleLotMetadataFieldChange("reason", event.target.value)
                        }
                        disabled={isSavingLotMetadata}
                      />
                    </label>

                    {selectedLotWhitelistLot.latestEditReason ? (
                      <div className="products-lot-metadata__history">
                        <strong>เหตุผลล่าสุด</strong>
                        <p>{selectedLotWhitelistLot.latestEditReason}</p>
                      </div>
                    ) : null}

                    {lotMetadataError ? (
                      <div className="products-alert error">{lotMetadataError}</div>
                    ) : null}
                    {lotMetadataStatus ? (
                      <div className="products-alert success">{lotMetadataStatus}</div>
                    ) : null}

                    <div className="products-lot-metadata__actions">
                      <button
                        type="button"
                        className="products-btn"
                        onClick={handleLotMetadataSave}
                        disabled={isSavingLotMetadata}
                      >
                        {isSavingLotMetadata ? "กำลังบันทึก..." : "บันทึก lot metadata"}
                      </button>
                      <button
                        type="button"
                        className="products-btn secondary"
                        onClick={handleLotMetadataReset}
                        disabled={isSavingLotMetadata}
                      >
                        คืนค่าฟอร์ม
                      </button>
                    </div>
                  </div>

                  {selectedLotWhitelistLot.invalidUnitLevelIds.length ? (
                    <div className="products-alert error">
                      lot นี้มี whitelist เก่าที่อ้างถึง packaging ที่ไม่ active แล้ว กรุณาเลือกและบันทึกใหม่
                    </div>
                  ) : null}

                  <div className="products-lot-whitelist__levels">
                    {lotWhitelistData.unitLevels.map((unitLevel) => {
                      const isChecked = lotWhitelistDraft.allowedUnitLevelIds.includes(unitLevel.id);
                      return (
                        <div className="products-lot-whitelist__level" key={unitLevel.id}>
                          <label className="products-lot-whitelist__level-check">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isSavingLotWhitelist}
                              onChange={(event) =>
                                handleLotWhitelistUnitToggle(unitLevel.id, event.target.checked)
                              }
                            />
                            <span>{unitLevel.displayName}</span>
                          </label>
                          <div className="products-lot-whitelist__level-meta">
                            <span>{unitLevel.unitTypeCode || "-"}</span>
                            {unitLevel.isBase ? <span>ฐาน</span> : null}
                            {unitLevel.isSellable ? <span>ขายหลัก</span> : null}
                          </div>
                          <label className="products-lot-whitelist__default">
                            <input
                              type="radio"
                              name="products-lot-whitelist-default"
                              checked={lotWhitelistDraft.defaultUnitLevelId === unitLevel.id}
                              disabled={!isChecked || isSavingLotWhitelist}
                              onChange={() => handleLotWhitelistDefaultChange(unitLevel.id)}
                            />
                            <span>default</span>
                          </label>
                        </div>
                      );
                    })}
                  </div>

                  <div className="products-lot-whitelist__actions">
                    <button
                      type="button"
                      className="products-btn"
                      onClick={handleLotWhitelistSave}
                      disabled={isSavingLotWhitelist}
                    >
                      {isSavingLotWhitelist ? "กำลังบันทึก..." : "บันทึก lot whitelist"}
                    </button>
                    <button
                      type="button"
                      className="products-btn secondary"
                      onClick={handleLotWhitelistReset}
                      disabled={isSavingLotWhitelist}
                    >
                      คืนค่าตามที่บันทึกไว้
                    </button>
                  </div>

                  {lotWhitelistStatus ? (
                    <div className="products-alert success">{lotWhitelistStatus}</div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {errorText ? <div className="products-alert error">{errorText}</div> : null}
      {statusText ? <div className="products-alert success">{statusText}</div> : null}

      <div className="products-table-toolbar">
        <div className="products-table-count">
          {loading ? "กำลังโหลดรายการสินค้า..." : `รายการสินค้า ${items.length} รายการ`}
        </div>
        <div className="products-table-toolbar-actions">
          <button
            type="button"
            className="products-btn secondary"
            onClick={handleExportProducts}
            disabled={loading || !items.length}
          >
            ส่งออก Excel ตัวยาทั้งหมด
          </button>
          <button
            type="button"
            className="products-btn secondary"
            onClick={handleOpenBranchExportModal}
            disabled={isExportingBranchStock}
          >
            ส่งออก Excel สินค้าปัจจุบันของสาขา
          </button>
        </div>
      </div>

      <div className="products-table-wrap">
        <table className="products-table">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>บาร์โค้ด</th>
              <th>ชื่อการค้า</th>
              <th>ผู้ผลิต/ผู้นำเข้า</th>
              <th>ชื่อสามัญ</th>
              <th>บรรจุภัณฑ์</th>
              <th>ราคา</th>
              <th>ชนิดรายงาน</th>
              <th>หน่วยรายงานจำนวนที่รับ</th>
              <th>รูปแบบยา</th>
              <th>สถานะ</th>
              <th>การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={12}>กำลังโหลด...</td>
              </tr>
            ) : items.length ? (
              items.map((item) => (
                <tr
                  key={item.id}
                  className={`products-table-row${
                    stockModalProduct?.id === item.id ? " is-stock-selected" : ""
                  }`}
                  tabIndex={0}
                  title="คลิกเพื่อดู stock ตาม lot"
                  onClick={() => handleOpenStockModal(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleOpenStockModal(item);
                    }
                  }}
                >
                  <td>{item.productCode || "-"}</td>
                  <td>{item.barcode || "-"}</td>
                  <td>{item.tradeName}</td>
                  <td>{item.manufacturerName || "-"}</td>
                  <td>{item.genericName || "-"}</td>
                  <td title={item.packagingSummary || item.packageSize || "-"}>
                    {item.packagingSummary || item.packageSize || "-"}
                  </td>
                  <td>
                    {formatProductPrice(item.price)}
                  </td>
                  <td>
                    {getProductReportGroups(item)}
                  </td>
                  <td title={item.reportReceiveUnitLabel || "-"}>
                    {item.reportReceiveUnitShortLabel || item.reportReceiveUnitLabel || "-"}
                  </td>
                  <td>{item.dosageFormCode || "-"}</td>
                  <td>{item.isActive ? "ใช้งาน" : "ปิดใช้งาน"}</td>
                  <td>
                    <div className="products-row-actions">
                      <button
                        type="button"
                        className="products-btn small"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleEditClick(item);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        แก้ไข
                      </button>
                      <button
                        type="button"
                        className="products-btn small danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteClick(item);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        ลบ
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={12}>ไม่พบข้อมูล</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isBranchExportModalOpen ? (
        <div
          className="products-export-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="products-branch-export-title"
          onMouseDown={handleBranchExportBackdrop}
        >
          <div className="products-export-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="products-export-modal__header">
              <div>
                <h2 id="products-branch-export-title">ส่งออก Excel สินค้าปัจจุบันของสาขา</h2>
                <p>ไฟล์จะรวมเฉพาะสินค้าที่มี stock คงเหลือมากกว่า 0 และแจกแจงจำนวนแยกตาม lot</p>
              </div>
              <button
                type="button"
                className="products-btn small secondary"
                onClick={handleCloseBranchExportModal}
                disabled={isExportingBranchStock}
              >
                ปิด
              </button>
            </div>

            <label className="products-export-modal__field">
              เลือกสาขา
              <select
                value={selectedBranchExportCode}
                onChange={(event) => setSelectedBranchExportCode(event.target.value)}
                disabled={isLoadingBranchExportOptions || isExportingBranchStock || !isAdmin}
              >
                {branchExportOptions.map((branch) => (
                  <option key={branch.code} value={branch.code}>
                    {branch.code}
                    {branch.name ? ` : ${branch.name}` : ""}
                  </option>
                ))}
              </select>
            </label>

            {!isAdmin ? (
              <div className="products-export-modal__note">บัญชีนี้ส่งออกได้เฉพาะสาขาของตัวเอง</div>
            ) : null}
            {isLoadingBranchExportOptions ? (
              <div className="products-export-modal__note">กำลังโหลดรายการสาขา...</div>
            ) : null}
            {branchExportError ? <div className="products-alert error">{branchExportError}</div> : null}

            <div className="products-export-modal__actions">
              <button
                type="button"
                className="products-btn"
                onClick={handleExportBranchStock}
                disabled={
                  isLoadingBranchExportOptions ||
                  isExportingBranchStock ||
                  !selectedBranchExportCode ||
                  !branchExportOptions.length
                }
              >
                {isExportingBranchStock ? "กำลังส่งออก..." : "ตกลง"}
              </button>
              <button
                type="button"
                className="products-btn secondary"
                onClick={handleCloseBranchExportModal}
                disabled={isExportingBranchStock}
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ProductsStockModal product={stockModalProduct} onClose={handleCloseStockModal} />
    </section>
  );
}
