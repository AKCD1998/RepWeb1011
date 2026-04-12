import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdminIncidentModal from "../components/AdminIncidentModal";
import { useAuth } from "../context/AuthContext";
import { dispenseApi, inventoryApi, productsApi } from "../lib/api";
import { formatDateOnlyDisplay } from "../lib/dateOnly";
import { formatQuantityAsUnits } from "../lib/productUnits";
import { parseDeliverNotes } from "../utils/deliverPatientParser";
import {
  SMARTCARD_DEFAULTS,
  buildDeliverNotesFromCard,
  startSmartcardListener,
} from "../utils/deliverSmartcard";
import {
  DELIVERY_METADATA_CACHE_TTL_MS,
  buildProductLotCacheKey,
  getProductLotsWithCache,
  hydrateProductMetadata,
  productLookup,
  syncDeliverMetadataSnapshot,
} from "../utils/deliverCache";
import {
  listPendingDispenses,
  removePendingDispense,
  savePendingDispense,
  updatePendingDispense,
} from "../utils/pendingDispenseQueue";
import "./Deliver.css";

const toMoney = (value) => Number(value || 0).toFixed(2);
const REPORT_TYPE_META = {
  KY10: "KY10 - ขย.10 ยาควบคุมพิเศษ",
  KY11: "KY11 - ขย.11 ยาอันตรายที่ต้องมีการควบคุมปริมาณการจำหน่าย",
};
const SUPPORTED_REPORT_TYPES = new Set(Object.keys(REPORT_TYPE_META));
const SMARTCARD_BROKER_URL =
  toCleanText(import.meta.env.VITE_SMARTCARD_MQTT_URL) ||
  SMARTCARD_DEFAULTS.brokerUrl;
const SMARTCARD_TOPIC =
  toCleanText(import.meta.env.VITE_SMARTCARD_MQTT_TOPIC) ||
  SMARTCARD_DEFAULTS.topic;
const SMARTCARD_DUPLICATE_WINDOW_MS = 10000;

function toCleanText(value) {
  return String(value || "").trim();
}

function toItemKey(value) {
  return toCleanText(value).toLowerCase();
}

function toDisplayKey(value) {
  return toCleanText(value).replace(/\s+/g, " ").toLowerCase();
}

function toDateLabel(value) {
  return formatDateOnlyDisplay(value);
}

function buildProductIdentityKey(productId, productCode) {
  const safeProductId = toCleanText(productId);
  if (safeProductId) return `id:${safeProductId}`;

  const safeProductCode = toCleanText(productCode);
  if (safeProductCode) return `code:${safeProductCode}`;

  return "";
}

function getProductCodeValue(product) {
  return toCleanText(product?.productCode ?? product?.companyCode ?? product?.product_code ?? "");
}

function getItemIdentity(item) {
  return buildProductIdentityKey(item?.id ?? item?.productId, getProductCodeValue(item)) || toItemKey(item?.name);
}

function normalizeReportGroupCodes(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Set();
  value.forEach((entry) => {
    const normalized = toCleanText(entry).toUpperCase();
    if (normalized) unique.add(normalized);
  });
  return [...unique];
}

function normalizeDeliverSearchProductRow(row) {
  const quantityBase = Number(row?.quantityBase ?? row?.quantity_base ?? 0);
  const reportGroupCodes = normalizeReportGroupCodes(row?.reportGroupCodes ?? row?.report_group_codes);
  const genericName = toCleanText(row?.genericName ?? row?.generic_name);
  const activeIngredientText = toCleanText(
    row?.activeIngredientText ?? row?.active_ingredient_text
  );
  const productCode = getProductCodeValue(row);
  const barcode = toCleanText(row?.barcode);
  const name = toCleanText(row?.tradeName ?? row?.productName ?? row?.name) || "-";
  return {
    id: toCleanText(row?.id ?? row?.productId ?? row?.product_id),
    productCode,
    companyCode: productCode,
    name,
    barcode,
    genericName,
    activeIngredientText,
    price: Number(row?.price ?? 0),
    unit: toCleanText(row?.unitLabel ?? row?.unit ?? row?.baseUnitLabel),
    baseUnitLabel: toCleanText(row?.baseUnitLabel ?? row?.base_unit_label ?? row?.unit ?? row?.unitLabel),
    quantityBase: Number.isFinite(quantityBase) ? quantityBase : 0,
    reportGroupCodes,
    searchText: [
      productCode,
      barcode,
      name,
      genericName,
      activeIngredientText,
      ...reportGroupCodes,
    ]
      .join(" ")
      .toLowerCase(),
  };
}

function filterDeliverSearchProducts(products, searchTerm) {
  const normalizedTerm = toCleanText(searchTerm).toLowerCase();
  if (!normalizedTerm) return products;
  return products.filter((product) => toCleanText(product?.searchText).includes(normalizedTerm));
}

function getDeliverSearchCategory(product) {
  const reportGroupCodes = normalizeReportGroupCodes(product?.reportGroupCodes);
  if (reportGroupCodes.includes("KY10")) {
    return {
      code: "KY10",
      label: "ขย.10",
      description: "ยาควบคุมพิเศษ",
      sortOrder: 0,
    };
  }

  return {
    code: "KY11_TRAMADOL",
    label: "ขย.11 + TRAMADOL",
    description: "ยาอันตราย",
    sortOrder: 1,
  };
}

function buildLotCacheKey(productId, productCode, branchCode) {
  return buildProductLotCacheKey({ productId, productCode, branchCode });
}

function resolveLotSelection(
  options,
  { preferredLotId = "", preferredLotNo = "", allowFallbackToFirstLot = true } = {}
) {
  const list = Array.isArray(options) ? options : [];
  const safePreferredLotId = toCleanText(preferredLotId);
  const safePreferredLotNo = toCleanText(preferredLotNo);
  const matchedLot =
    list.find((option) => toCleanText(option?.lotId) === safePreferredLotId) ||
    list.find((option) => toCleanText(option?.lotNo) === safePreferredLotNo) ||
    (allowFallbackToFirstLot ? list[0] || null : null);

  return {
    lotId: toCleanText(matchedLot?.lotId),
    lotNo: toCleanText(matchedLot?.lotNo),
    lotExpDate: toCleanText(matchedLot?.expDate),
  };
}

function normalizeLotOptionsForPending(options, selectedLot = {}) {
  const seen = new Set();
  const rows = [];

  (Array.isArray(options) ? options : []).forEach((option) => {
    const lotId = toCleanText(option?.lotId);
    const lotNo = toCleanText(option?.lotNo);
    const expDate = toCleanText(option?.expDate);
    const key = lotId || `${lotNo}|${expDate}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push({ lotId, lotNo, expDate });
  });

  const selectedLotId = toCleanText(selectedLot?.lotId);
  const selectedLotNo = toCleanText(selectedLot?.lotNo);
  const selectedExpDate = toCleanText(selectedLot?.expDate ?? selectedLot?.lotExpDate);
  const selectedKey = selectedLotId || `${selectedLotNo}|${selectedExpDate}`;
  if (selectedKey && !seen.has(selectedKey)) {
    rows.push({
      lotId: selectedLotId,
      lotNo: selectedLotNo,
      expDate: selectedExpDate,
    });
  }

  return rows;
}

function isBrowserOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

function isNetworkLikeError(error) {
  if (!isBrowserOnline()) return true;
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("err_network") ||
    message.includes("timeout") ||
    message.includes("econn")
  );
}

function formatMetadataCacheTime(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function clonePendingPayload(payload = {}) {
  return {
    ...payload,
    patient: { ...(payload.patient || {}) },
    lines: (Array.isArray(payload.lines) ? payload.lines : []).map((line) => ({
      ...line,
      lotOptions: normalizeLotOptionsForPending(line?.lotOptions, line),
    })),
  };
}

function buildPendingDraft(record) {
  if (!record) return null;
  return {
    ...record,
    payload: clonePendingPayload(record.payload || {}),
  };
}

function buildLineNote(item, fallbackReportType = "") {
  const metadata = [];
  const reportType = toCleanText(item?.reportType || fallbackReportType).toUpperCase();
  if (SUPPORTED_REPORT_TYPES.has(reportType)) {
    metadata.push(`reportType=${reportType}`);
  }

  const lotNo = toCleanText(item?.lotNo);
  if (lotNo) {
    metadata.push(`lotNo=${lotNo}`);
  }

  if (!metadata.length) return null;
  return `[${metadata.join(" ")}]`;
}

function normalizeUnitLevelOption(row) {
  return {
    id: toCleanText(row?.id),
    code: toCleanText(row?.code),
    displayName: toCleanText(row?.displayName || row?.display_name || row?.code),
    isSellable: Boolean(row?.isSellable ?? row?.is_sellable),
    isBase: Boolean(row?.isBase ?? row?.is_base),
    sortOrder: Number(row?.sortOrder ?? row?.sort_order ?? 0),
    barcode: toCleanText(row?.barcode),
    unitTypeCode: toCleanText(row?.unitTypeCode || row?.unit_type_code).toUpperCase(),
    unitTypeLabel: toCleanText(row?.unitTypeLabel || row?.unit_type_label),
  };
}

function compareUnitLevelOptions(a, b, defaultUnitLevelId = "") {
  const aDefault = a.id === defaultUnitLevelId ? 1 : 0;
  const bDefault = b.id === defaultUnitLevelId ? 1 : 0;
  if (aDefault !== bDefault) return bDefault - aDefault;
  if (a.isSellable !== b.isSellable) return Number(b.isSellable) - Number(a.isSellable);
  if (a.isBase !== b.isBase) return Number(b.isBase) - Number(a.isBase);
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.displayName.localeCompare(b.displayName);
}

function pickMatchingUnitLevelOption(options, line, defaultUnitLevelId = "") {
  const explicitUnitLevelId = toCleanText(line?.unitLevelId || line?.unit_level_id);
  if (explicitUnitLevelId) {
    const explicitMatch = options.find((option) => option.id === explicitUnitLevelId);
    if (explicitMatch) return explicitMatch;
  }

  const barcode = toCleanText(line?.barcode);
  if (barcode) {
    const barcodeMatches = options.filter((option) => toCleanText(option.barcode) === barcode);
    if (barcodeMatches.length) {
      return [...barcodeMatches].sort((a, b) => compareUnitLevelOptions(a, b, defaultUnitLevelId))[0] || null;
    }
  }

  const candidateKeys = [
    line?.unitLabel,
    line?.unit,
    line?.unitTypeLabel,
    line?.unitTypeCode,
  ]
    .map(toDisplayKey)
    .filter(Boolean);

  if (!candidateKeys.length) return null;

  const matching = options.filter((option) => {
    const optionKeys = new Set(
      [option.displayName, option.unitTypeLabel, option.unitTypeCode, option.code]
        .map(toDisplayKey)
        .filter(Boolean)
    );
    return candidateKeys.some((candidateKey) => optionKeys.has(candidateKey));
  });
  if (!matching.length) return null;

  return [...matching].sort((a, b) => compareUnitLevelOptions(a, b, defaultUnitLevelId))[0] || null;
}

export default function Deliver() {
  const { user } = useAuth();
  const userRole = toCleanText(user?.role).toUpperCase();
  const isAdmin = userRole === "ADMIN";
  const userBranchCode = toCleanText(user?.branchCode || user?.branch_code || "");
  const [items, setItems] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isIncidentModalOpen, setIsIncidentModalOpen] = useState(false);
  const [incidentModalSeed, setIncidentModalSeed] = useState(null);
  const [isProductSearchModalOpen, setIsProductSearchModalOpen] = useState(false);
  const [pendingMultiplier, setPendingMultiplier] = useState(null);
  const [deliverNotes, setDeliverNotes] = useState("");
  const [reportTypeOptions, setReportTypeOptions] = useState([]);
  const [selectedReportType, setSelectedReportType] = useState("");
  const [lotOptions, setLotOptions] = useState([]);
  const [selectedLotId, setSelectedLotId] = useState("");
  const [activeMetadataCacheStatus, setActiveMetadataCacheStatus] = useState(null);
  const [selectedProductName, setSelectedProductName] = useState("");
  const [activeItemKey, setActiveItemKey] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [branchOptions, setBranchOptions] = useState([]);
  const [selectedBranchCode, setSelectedBranchCode] = useState(userBranchCode);
  const effectiveBranchCode = isAdmin ? toCleanText(selectedBranchCode) : userBranchCode;
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [branchLoadError, setBranchLoadError] = useState("");
  const [deliverSearchProducts, setDeliverSearchProducts] = useState([]);
  const [deliverSearchLoadError, setDeliverSearchLoadError] = useState("");
  const [isLoadingDeliverSearchProducts, setIsLoadingDeliverSearchProducts] = useState(false);
  const [selectedDeliverSearchProductId, setSelectedDeliverSearchProductId] = useState("");
  const [deliverSearchDraft, setDeliverSearchDraft] = useState("");
  const [deliverSearchTerm, setDeliverSearchTerm] = useState("");
  const [smartcardStatus, setSmartcardStatus] = useState({
    tone: "info",
    message: "กำลังเริ่ม smartcard listener",
  });
  const [hasCapturedSmartcardData, setHasCapturedSmartcardData] = useState(false);
  const [isOnline, setIsOnline] = useState(isBrowserOnline);
  const [pendingDispenses, setPendingDispenses] = useState([]);
  const [pendingLoadError, setPendingLoadError] = useState("");
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [pendingReviewId, setPendingReviewId] = useState("");
  const [pendingReviewDraft, setPendingReviewDraft] = useState(null);
  const [pendingReviewError, setPendingReviewError] = useState("");
  const [isSyncingPending, setIsSyncingPending] = useState(false);
  const barcodeInputRef = useRef(null);
  const lotOptionsCacheRef = useRef(new Map());
  const lotOptionsMetaCacheRef = useRef(new Map());
  const itemsRef = useRef([]);
  const activeItemKeyRef = useRef("");
  const deliverNotesRef = useRef("");
  const lastAutoFilledNotesRef = useRef("");
  const lastSmartcardFillRef = useRef({ signature: "", at: 0 });

  const parsedNotes = useMemo(() => parseDeliverNotes(deliverNotes), [deliverNotes]);

  const selectPendingReview = useCallback((record) => {
    const draft = buildPendingDraft(record);
    setPendingReviewDraft(draft);
    setPendingReviewId(toCleanText(draft?.localTxnId));
    setPendingReviewError("");
  }, []);

  const refreshPendingDispenses = useCallback(
    async ({ openWhenOnline = false } = {}) => {
      try {
        const rows = await listPendingDispenses();
        setPendingDispenses(rows);
        setPendingLoadError("");

        const currentId = pendingReviewId;
        const currentRecord =
          (currentId && rows.find((row) => row.localTxnId === currentId)) ||
          rows[0] ||
          null;

        if (currentRecord) {
          selectPendingReview(currentRecord);
        } else {
          setPendingReviewId("");
          setPendingReviewDraft(null);
        }

        if (openWhenOnline && rows.length) {
          setIsPendingModalOpen(true);
        }

        return rows;
      } catch (error) {
        setPendingLoadError(error?.message || "ไม่สามารถโหลดรายการค้างในเครื่องนี้ได้");
        return [];
      }
    },
    [pendingReviewId, selectPendingReview]
  );

  useEffect(() => {
    const updateOnlineStatus = () => {
      setIsOnline(isBrowserOnline());
    };

    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    void refreshPendingDispenses({ openWhenOnline: isOnline });
  }, [isOnline, refreshPendingDispenses]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    activeItemKeyRef.current = activeItemKey;
  }, [activeItemKey]);

  useEffect(() => {
    deliverNotesRef.current = deliverNotes;
  }, [deliverNotes]);

  useEffect(() => {
    setSelectedBranchCode(userBranchCode);
  }, [userBranchCode]);

  useEffect(() => {
    if (isAdmin && !effectiveBranchCode) {
      syncDeliverMetadataSnapshot().catch(() => {});
      return undefined;
    }

    let cancelled = false;
    const refreshSnapshot = () => {
      syncDeliverMetadataSnapshot({ branchCode: effectiveBranchCode }).catch(() => {});
    };

    refreshSnapshot();
    const timer = window.setInterval(() => {
      if (!cancelled) refreshSnapshot();
    }, DELIVERY_METADATA_CACHE_TTL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [effectiveBranchCode, isAdmin]);

  const handleSmartcardData = useCallback((normalized) => {
    const nextNotes = buildDeliverNotesFromCard(normalized?.fields);
    if (!nextNotes) {
      console.warn("[deliver-smartcard] no usable card fields for note autofill", normalized);
      setSmartcardStatus({
        tone: "warn",
        message: "ได้รับข้อมูลบัตรแล้ว แต่ยังไม่มีฟิลด์ที่ใช้กรอกผู้รับมอบยาได้",
      });
      return;
    }

    setHasCapturedSmartcardData(true);

    const currentNotes = deliverNotesRef.current;
    const canReplaceCurrentNotes =
      !toCleanText(currentNotes) || currentNotes === lastAutoFilledNotesRef.current;
    const now = Date.now();
    const duplicateWithinWindow =
      lastSmartcardFillRef.current.signature === nextNotes &&
      now - lastSmartcardFillRef.current.at < SMARTCARD_DUPLICATE_WINDOW_MS;

    if (duplicateWithinWindow && (!canReplaceCurrentNotes || currentNotes === lastAutoFilledNotesRef.current)) {
      lastSmartcardFillRef.current = { signature: nextNotes, at: now };
      console.debug("[deliver-smartcard] duplicate card event ignored", {
        duplicateWindowMs: SMARTCARD_DUPLICATE_WINDOW_MS,
        note: nextNotes,
      });
      setSmartcardStatus({
        tone: "info",
        message: "ได้รับ event ซ้ำของบัตรเดิม ระบบจึงไม่กรอกข้อความซ้ำ",
      });
      return;
    }

    lastSmartcardFillRef.current = { signature: nextNotes, at: now };

    if (!canReplaceCurrentNotes) {
      console.info("[deliver-smartcard] card data received but notes were preserved", {
        note: nextNotes,
      });
      setSmartcardStatus({
        tone: "warn",
        message:
          "ได้รับข้อมูลบัตรแล้ว แต่ช่องหมายเหตุถูกแก้ไขเอง ระบบจึงไม่เขียนทับอัตโนมัติ",
      });
      return;
    }

    lastAutoFilledNotesRef.current = nextNotes;
    deliverNotesRef.current = nextNotes;
    setDeliverNotes(nextNotes);
    const patientName = toCleanText(
      normalized?.fields?.thaiName ||
        normalized?.fields?.fullName ||
        normalized?.fields?.englishName
    );

    setSmartcardStatus({
      tone: "success",
      message: patientName
        ? `ดึงข้อมูลบัตรสำเร็จและกรอกผู้รับมอบยา: ${patientName}`
        : "ดึงข้อมูลบัตรสำเร็จและกรอกข้อมูลลงในช่องผู้รับมอบยาแล้ว",
    });
  }, []);

  useEffect(() => {
    const stopSmartcardListener = startSmartcardListener({
      brokerUrl: SMARTCARD_BROKER_URL,
      topic: SMARTCARD_TOPIC,
      onStatusChange: (nextStatus) => {
        setSmartcardStatus({
          tone: nextStatus?.tone || "info",
          message: nextStatus?.message || "smartcard listener ทำงานอยู่",
        });
      },
      onCardData: handleSmartcardData,
    });

    return () => {
      stopSmartcardListener();
    };
  }, [handleSmartcardData]);

  const loadBranchOptions = useCallback(async () => {
    if (!isAdmin) {
      setBranchOptions([]);
      setBranchLoadError("");
      setIsLoadingBranches(false);
      return;
    }

    setIsLoadingBranches(true);
    try {
      const rows = await inventoryApi.listLocations({
        includeInactive: false,
        locationType: "BRANCH",
      });
      const normalized = (Array.isArray(rows) ? rows : [])
        .map((row) => ({
          id: toCleanText(row?.id),
          code: toCleanText(row?.code),
          name: toCleanText(row?.name),
        }))
        .filter((row) => row.code)
        .sort((a, b) => {
          if (a.code !== b.code) return a.code.localeCompare(b.code);
          return a.name.localeCompare(b.name);
        });
      setBranchOptions(normalized);
      setBranchLoadError("");
    } catch (error) {
      setBranchOptions([]);
      setBranchLoadError(error?.message || "ไม่สามารถโหลดรายการสาขาได้");
    } finally {
      setIsLoadingBranches(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadBranchOptions();
  }, [loadBranchOptions]);

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const handleKeydown = (event) => {
      if (event.key === "Escape" && !isSubmitting) {
        setIsModalOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [isModalOpen, isSubmitting]);

  useEffect(() => {
    if (!isProductSearchModalOpen) return undefined;
    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        setIsProductSearchModalOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [isProductSearchModalOpen]);

  const buildReportTypeOptions = useCallback((product) => {
    const rawCodes = Array.isArray(product?.reportGroupCodes)
      ? product.reportGroupCodes
      : [];

    const unique = [];
    rawCodes.forEach((code) => {
      const normalized = String(code || "").trim().toUpperCase();
      if (!SUPPORTED_REPORT_TYPES.has(normalized)) return;
      if (unique.includes(normalized)) return;
      unique.push(normalized);
    });

    return unique.map((code) => ({
      code,
      label: REPORT_TYPE_META[code] || code,
    }));
  }, []);

  const loadLotsForProduct = useCallback(
    async (product) => {
      if (isAdmin && !effectiveBranchCode) {
        return { lotCacheKey: "", lots: [], source: "missing-branch", cachedAt: null, stale: true };
      }

      const productId = toCleanText(product?.id ?? product?.productId);
      const productCode = toCleanText(
        product?.productCode ?? product?.companyCode ?? product?.product_code ?? ""
      );
      const lotCacheKey = buildLotCacheKey(productId, productCode, effectiveBranchCode);
      if (!lotCacheKey) {
        return { lotCacheKey: "", lots: [], source: "missing-key", cachedAt: null, stale: true };
      }

      if (!isOnline && lotOptionsCacheRef.current.has(lotCacheKey)) {
        const memoryMeta = lotOptionsMetaCacheRef.current.get(lotCacheKey) || {};
        return {
          lotCacheKey,
          lots: lotOptionsCacheRef.current.get(lotCacheKey) || [],
          ...memoryMeta,
          source: "cache",
          cachedAt: memoryMeta.cachedAt || null,
          stale: Boolean(memoryMeta.stale),
        };
      }

      const result = await getProductLotsWithCache(
        {
          productId,
          productCode,
          branchCode: effectiveBranchCode,
        },
        { preferCache: !isOnline }
      );
      const lots = Array.isArray(result?.lots) ? result.lots : [];
      lotOptionsCacheRef.current.set(lotCacheKey, lots);
      lotOptionsMetaCacheRef.current.set(lotCacheKey, {
        source: result?.source || "cache",
        cachedAt: result?.cachedAt || null,
        stale: Boolean(result?.stale),
        error: result?.error || "",
      });

      return { lotCacheKey, ...result, lots };
    },
    [effectiveBranchCode, isAdmin, isOnline]
  );

  const syncProductMeta = useCallback(
    async (product) => {
      const metadata = await hydrateProductMetadata(product, { preferServer: isOnline });
      const source = metadata || product;
      const itemName = toCleanText(source?.name || product?.name);
      const itemKey = getItemIdentity(source || product);

      setSelectedProductName(itemName);
      setActiveItemKey(itemKey);

      const nextReportOptions = buildReportTypeOptions(source);
      setReportTypeOptions(nextReportOptions);

      const matchingItem = items.find((item) => getItemIdentity(item) === itemKey);
      const preferredReportType = toCleanText(
        matchingItem?.reportType || selectedReportType
      ).toUpperCase();
      const resolvedReportType = nextReportOptions.some(
        (option) => option.code === preferredReportType
      )
        ? preferredReportType
        : nextReportOptions[0]?.code || "";
      setSelectedReportType(resolvedReportType);

      const productId = toCleanText(source?.id);
      const productCode = toCleanText(
        source?.productCode ?? source?.companyCode ?? ""
      );
      const lotCacheKey = buildLotCacheKey(productId, productCode, effectiveBranchCode);

      if (!lotCacheKey) {
        setLotOptions([]);
        setSelectedLotId("");
        setActiveMetadataCacheStatus({
          productName: itemName,
          reportTypeCount: nextReportOptions.length,
          lotCount: 0,
          lotCacheKey: "",
          source: isAdmin && !effectiveBranchCode ? "missing-branch" : "missing-key",
          cachedAt: null,
          stale: true,
          error: "",
        });
        if (itemKey) {
          setItems((prev) =>
            prev.map((item) =>
              getItemIdentity(item) === itemKey
                ? {
                    ...item,
                    reportType: resolvedReportType,
                    lotNo: "",
                    lotId: "",
                    lotExpDate: "",
                  }
                : item
            )
          );
        }
        return;
      }

      let cachedLots = [];
      let lotStatus = {
        lotCacheKey,
        source: "missing-cache",
        cachedAt: null,
        stale: true,
        error: "",
      };
      try {
        const result = await loadLotsForProduct({ id: productId, productCode });
        cachedLots = Array.isArray(result?.lots) ? result.lots : [];
        lotStatus = {
          lotCacheKey,
          source: result?.source || "cache",
          cachedAt: result?.cachedAt || null,
          stale: Boolean(result?.stale),
          error: result?.error || "",
        };
      } catch {
        cachedLots = [];
        lotStatus = {
          lotCacheKey,
          source: isOnline ? "error" : "missing-cache",
          cachedAt: null,
          stale: true,
          error: "",
        };
      }

      setLotOptions(cachedLots);
      setActiveMetadataCacheStatus({
        productName: itemName,
        reportTypeCount: nextReportOptions.length,
        lotCount: cachedLots.length,
        ...lotStatus,
      });
      const { lotId: resolvedLotId, lotNo: resolvedLotNo, lotExpDate: resolvedLotExpDate } =
        resolveLotSelection(cachedLots, {
          preferredLotId: matchingItem?.lotId || selectedLotId,
          preferredLotNo: matchingItem?.lotNo,
        });

      setSelectedLotId(resolvedLotId);

      if (itemKey) {
        setItems((prev) =>
          prev.map((item) =>
            getItemIdentity(item) === itemKey
              ? {
                  ...item,
                  reportType: resolvedReportType,
                  lotNo: resolvedLotNo,
                  lotId: resolvedLotId,
                  lotExpDate: resolvedLotExpDate,
                }
              : item
          )
        );
      }
    },
    [
      buildReportTypeOptions,
      effectiveBranchCode,
      isAdmin,
      isOnline,
      items,
      loadLotsForProduct,
      selectedLotId,
      selectedReportType,
    ]
  );

  useEffect(() => {
    if (!isAdmin) return undefined;

    let cancelled = false;

    const revalidateLotsForBranch = async () => {
      const currentItems = itemsRef.current;
      if (!currentItems.length) {
        setLotOptions([]);
        setSelectedLotId("");
        setActiveMetadataCacheStatus(null);
        return;
      }

      const lotsByProductKey = new Map();
      const lotStatusByProductKey = new Map();

      for (const item of currentItems) {
        const productId = toCleanText(item?.id);
        const productCode = toCleanText(
          item?.productCode ?? item?.companyCode ?? item?.product_code ?? ""
        );
        const productKey = buildProductIdentityKey(productId, productCode);
        if (!productKey || lotsByProductKey.has(productKey)) continue;

        try {
          const result = await loadLotsForProduct({ id: productId, productCode });
          if (cancelled) return;
          lotsByProductKey.set(productKey, Array.isArray(result?.lots) ? result.lots : []);
          lotStatusByProductKey.set(productKey, {
            source: result?.source || "cache",
            cachedAt: result?.cachedAt || null,
            stale: Boolean(result?.stale),
            error: result?.error || "",
          });
        } catch {
          if (cancelled) return;
          lotsByProductKey.set(productKey, []);
          lotStatusByProductKey.set(productKey, {
            source: isOnline ? "error" : "missing-cache",
            cachedAt: null,
            stale: true,
            error: "",
          });
        }
      }

      if (cancelled) return;

      setItems((prev) =>
        prev.map((item) => {
          const productId = toCleanText(item?.id);
          const productCode = toCleanText(
            item?.productCode ?? item?.companyCode ?? item?.product_code ?? ""
          );
          const productKey = buildProductIdentityKey(productId, productCode);
          const lots = productKey ? lotsByProductKey.get(productKey) || [] : [];
          const nextLotSelection = resolveLotSelection(lots, {
            preferredLotId: item?.lotId,
            preferredLotNo: item?.lotNo,
          });

          return {
            ...item,
            lotId: nextLotSelection.lotId,
            lotNo: nextLotSelection.lotNo,
            lotExpDate: nextLotSelection.lotExpDate,
          };
        })
      );

      const activeKey = activeItemKeyRef.current;
      if (!activeKey) {
        setLotOptions([]);
        setSelectedLotId("");
        setActiveMetadataCacheStatus(null);
        return;
      }

      const activeItem =
        currentItems.find((item) => getItemIdentity(item) === activeKey) || null;
      if (!activeItem) {
        setLotOptions([]);
        setSelectedLotId("");
        setActiveMetadataCacheStatus(null);
        return;
      }

      const activeProductKey = buildProductIdentityKey(
        activeItem?.id,
        activeItem?.productCode ?? activeItem?.companyCode ?? activeItem?.product_code ?? ""
      );
      const activeLots = activeProductKey ? lotsByProductKey.get(activeProductKey) || [] : [];
      const nextActiveLotSelection = resolveLotSelection(activeLots, {
        preferredLotId: activeItem?.lotId,
        preferredLotNo: activeItem?.lotNo,
      });

      setLotOptions(activeLots);
      setSelectedLotId(nextActiveLotSelection.lotId);
      setActiveMetadataCacheStatus({
        productName: toCleanText(activeItem?.name),
        reportTypeCount: buildReportTypeOptions(activeItem).length,
        lotCount: activeLots.length,
        lotCacheKey: buildLotCacheKey(
          activeItem?.id,
          activeItem?.productCode ?? activeItem?.companyCode ?? activeItem?.product_code ?? "",
          effectiveBranchCode
        ),
        ...(lotStatusByProductKey.get(activeProductKey) || {
          source: isOnline ? "error" : "missing-cache",
          cachedAt: null,
          stale: true,
          error: "",
        }),
      });
    };

    void revalidateLotsForBranch();

    return () => {
      cancelled = true;
    };
  }, [buildReportTypeOptions, effectiveBranchCode, isAdmin, isOnline, loadLotsForProduct]);

  const parseMultiplier = useCallback((rawValue) => {
    const normalized = String(rawValue ?? "").trim();
    if (!normalized || !/^\d+$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, []);

  const armMultiplierFromInput = useCallback(
    (rawValue) => {
      const nextMultiplier = parseMultiplier(rawValue);
      if (!nextMultiplier) {
        console.warn("จำนวนคูณไม่ถูกต้อง");
        return null;
      }
      setPendingMultiplier(nextMultiplier);
      return nextMultiplier;
    },
    [parseMultiplier]
  );

  const handleAddProduct = useCallback((product, qtyToAdd = 1) => {
    const safeQty = Number(qtyToAdd);
    const resolvedQty = Number.isFinite(safeQty) && safeQty > 0 ? safeQty : 1;
    setItems((prev) => {
      const key = getItemIdentity(product);
      const index = prev.findIndex((item) => getItemIdentity(item) === key);

      if (index >= 0) {
        const next = [...prev];
        next[index] = { ...next[index], qty: next[index].qty + resolvedQty };
        return next;
      }

      return [
        ...prev,
        {
          ...product,
          qty: resolvedQty,
          reportType: "",
          lotNo: "",
          lotId: "",
          lotExpDate: "",
        },
      ];
    });
  }, []);

  const loadDeliverSearchProducts = useCallback(async () => {
    if (isAdmin && !effectiveBranchCode) {
      setDeliverSearchProducts([]);
      setSelectedDeliverSearchProductId("");
      setDeliverSearchLoadError("กรุณาเลือกสาขาที่ทำรายการก่อนค้นหายา");
      return;
    }

    setIsLoadingDeliverSearchProducts(true);
    setDeliverSearchLoadError("");
    try {
      const rows = await inventoryApi.deliverSearchProducts(effectiveBranchCode);
      const normalized = (Array.isArray(rows) ? rows : [])
        .map(normalizeDeliverSearchProductRow)
        .filter((row) => row.id)
        .sort((left, right) => {
          const leftCategory = getDeliverSearchCategory(left);
          const rightCategory = getDeliverSearchCategory(right);
          if (leftCategory.sortOrder !== rightCategory.sortOrder) {
            return leftCategory.sortOrder - rightCategory.sortOrder;
          }
          if (left.name !== right.name) return left.name.localeCompare(right.name);
          return left.productCode.localeCompare(right.productCode);
        });
      setDeliverSearchProducts(normalized);
      setSelectedDeliverSearchProductId((prev) =>
        normalized.some((row) => row.id === prev) ? prev : ""
      );
    } catch (error) {
      setDeliverSearchProducts([]);
      setSelectedDeliverSearchProductId("");
      setDeliverSearchLoadError(error?.message || "ไม่สามารถโหลดรายการยาที่ค้นหาได้");
    } finally {
      setIsLoadingDeliverSearchProducts(false);
    }
  }, [effectiveBranchCode, isAdmin]);

  useEffect(() => {
    if (!isProductSearchModalOpen) return;
    void loadDeliverSearchProducts();
  }, [isProductSearchModalOpen, loadDeliverSearchProducts]);

  const handleOpenProductSearchModal = useCallback(() => {
    if (isAdmin && !effectiveBranchCode) {
      setSubmitError("กรุณาเลือกสาขาที่ทำรายการก่อนค้นหายา");
      return;
    }

    setSubmitError("");
    setDeliverSearchLoadError("");
    setSelectedDeliverSearchProductId("");
    setDeliverSearchDraft("");
    setDeliverSearchTerm("");
    setIsProductSearchModalOpen(true);
  }, [effectiveBranchCode, isAdmin]);

  const handleCloseProductSearchModal = useCallback(() => {
    setIsProductSearchModalOpen(false);
    setSelectedDeliverSearchProductId("");
    setDeliverSearchDraft("");
    setDeliverSearchTerm("");
  }, []);

  const handleProductSearchModalBackdrop = useCallback((event) => {
    if (event.target === event.currentTarget) {
      handleCloseProductSearchModal();
    }
  }, [handleCloseProductSearchModal]);

  const visibleDeliverSearchProducts = useMemo(
    () => filterDeliverSearchProducts(deliverSearchProducts, deliverSearchTerm),
    [deliverSearchProducts, deliverSearchTerm]
  );

  const handleCommitDeliverSearchTerm = useCallback(() => {
    setDeliverSearchTerm(toCleanText(deliverSearchDraft));
  }, [deliverSearchDraft]);

  const handleDeliverSearchInputKeyDown = useCallback(
    (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      handleCommitDeliverSearchTerm();
    },
    [handleCommitDeliverSearchTerm]
  );

  useEffect(() => {
    if (!selectedDeliverSearchProductId) return;
    if (visibleDeliverSearchProducts.some((product) => product.id === selectedDeliverSearchProductId)) return;
    setSelectedDeliverSearchProductId("");
  }, [selectedDeliverSearchProductId, visibleDeliverSearchProducts]);

  const selectedDeliverSearchProduct = useMemo(
    () => visibleDeliverSearchProducts.find((product) => product.id === selectedDeliverSearchProductId) || null,
    [visibleDeliverSearchProducts, selectedDeliverSearchProductId]
  );

  const commitDeliverSearchSelection = useCallback(
    async (product) => {
      const selectedProduct = product || selectedDeliverSearchProduct;
      if (!selectedProduct) return;

      handleAddProduct(selectedProduct, 1);
      setPendingMultiplier(null);
      setIsProductSearchModalOpen(false);
      setSelectedDeliverSearchProductId("");

      try {
        await syncProductMeta(selectedProduct);
      } catch {
        // keep added row even if metadata hydration fails
      }

      if (barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    },
    [handleAddProduct, selectedDeliverSearchProduct, syncProductMeta]
  );

  const handleBarcodeKeyDown = useCallback(
    async (event) => {
      const inputEl = event.currentTarget;
      const key = event.key;
      const code = event.code;
      const isMultiplyKey =
        key === "PageDown" || key === "*" || code === "NumpadMultiply";
      if (isMultiplyKey) {
        event.preventDefault();
        const armedQty = armMultiplierFromInput(inputEl?.value);
        if (armedQty) {
          if (inputEl) {
            inputEl.value = "";
            inputEl.focus();
          }
        }
        return;
      }

      if (key !== "Enter") return;
      event.preventDefault();

      const inputValue = String(inputEl?.value ?? "").trim();
      if (!inputValue) return;

      if (inputEl) {
        inputEl.value = "";
        inputEl.focus();
      }

      try {
        const qtyToAdd = pendingMultiplier ?? 1;
        const product = await productLookup(inputValue);
        if (product) {
          handleAddProduct(product, qtyToAdd);
          setPendingMultiplier(null);
          await syncProductMeta(product);
        } else {
          console.warn("ไม่พบสินค้า/ออฟไลน์");
        }
      } catch (error) {
        console.error("barcode flow failed", error);
      }
    },
    [armMultiplierFromInput, handleAddProduct, pendingMultiplier, syncProductMeta]
  );

  const handleCouponClick = useCallback(() => {
    const input = barcodeInputRef.current;
    if (!input) return;
    const armedQty = armMultiplierFromInput(input.value);
    if (armedQty) {
      input.value = "";
    }
    input.focus();
  }, [armMultiplierFromInput]);

  const handleCouponKeyDown = useCallback(
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      handleCouponClick();
    },
    [handleCouponClick]
  );

  const handleDelete = useCallback(
    (itemToDelete) => {
      const key = getItemIdentity(itemToDelete);
      setItems((prev) => prev.filter((item) => getItemIdentity(item) !== key));

      if (activeItemKey && activeItemKey === key) {
        setActiveItemKey("");
        setSelectedProductName("");
        setReportTypeOptions([]);
        setSelectedReportType("");
        setLotOptions([]);
        setSelectedLotId("");
        setActiveMetadataCacheStatus(null);
      }
    },
    [activeItemKey]
  );

  const handleActivateItem = useCallback(
    async (item) => {
      if (!item) return;
      try {
        await syncProductMeta(item);
      } catch {
        // keep current UI state if metadata fetch fails
      }
    },
    [syncProductMeta]
  );

  const handleReportTypeChange = useCallback(
    (event) => {
      const value = toCleanText(event.target.value).toUpperCase();
      setSelectedReportType(value);
      if (!activeItemKey) return;

      setItems((prev) =>
        prev.map((item) =>
          getItemIdentity(item) === activeItemKey
            ? { ...item, reportType: value }
            : item
        )
      );
    },
    [activeItemKey]
  );

  const handleLotSelectionChange = useCallback(
    (event) => {
      const lotId = toCleanText(event.target.value);
      setSelectedLotId(lotId);
      if (!activeItemKey) return;

      const matchedLot =
        lotOptions.find((option) => toCleanText(option.lotId) === lotId) || null;
      const lotNo = toCleanText(matchedLot?.lotNo);
      const lotExpDate = toCleanText(matchedLot?.expDate);

      setItems((prev) =>
        prev.map((item) =>
          getItemIdentity(item) === activeItemKey
            ? { ...item, lotNo, lotId, lotExpDate }
            : item
        )
      );
    },
    [activeItemKey, lotOptions]
  );

  const selectedBranchLabel = useMemo(() => {
    if (!effectiveBranchCode) {
      return isAdmin ? "-" : "ตามสิทธิ์ผู้ใช้";
    }
    const matched = branchOptions.find((branch) => branch.code === effectiveBranchCode);
    if (!matched) return effectiveBranchCode;
    return matched.name ? `${matched.code} : ${matched.name}` : matched.code;
  }, [branchOptions, effectiveBranchCode, isAdmin]);

  const activeMetadataCacheMessage = useMemo(() => {
    if (!selectedProductName || !activeMetadataCacheStatus) return "";

    const source = toCleanText(activeMetadataCacheStatus.source);
    const cachedAtLabel = formatMetadataCacheTime(activeMetadataCacheStatus.cachedAt);
    const suffix = cachedAtLabel ? ` (${cachedAtLabel})` : "";
    const stalePrefix = activeMetadataCacheStatus.stale ? "ข้อมูล cache เกิน 12 ชั่วโมง: " : "";

    if (source === "server") {
      return "ออนไลน์: ดึง report/lot จาก backend แล้ว และบันทึก cache สำหรับโหมดออฟไลน์";
    }
    if (source === "cache") {
      return `${stalePrefix}ใช้ report/lot จาก local cache${suffix}`;
    }
    if (source === "missing-branch") {
      return "กรุณาเลือกสาขาก่อน ระบบจึงจะดึงหรือใช้ cache ของ lot ได้";
    }
    if (source === "missing-cache" || source === "missing-key") {
      return "ยังไม่มี local cache ของ report/lot สำหรับสินค้านี้";
    }
    if (source === "error") {
      return activeMetadataCacheStatus.error || "ไม่สามารถโหลด report/lot จาก backend และไม่มี cache ในเครื่องนี้";
    }

    return "";
  }, [activeMetadataCacheStatus, selectedProductName]);

  const resetDispenseForm = useCallback(() => {
    setItems([]);
    setPendingMultiplier(null);
    setDeliverNotes("");
    deliverNotesRef.current = "";
    lastAutoFilledNotesRef.current = "";
    lastSmartcardFillRef.current = { signature: "", at: 0 };
    setHasCapturedSmartcardData(false);
    setReportTypeOptions([]);
    setSelectedReportType("");
    setLotOptions([]);
    setSelectedLotId("");
    setSelectedBranchCode(userBranchCode);
    setSelectedProductName("");
    setActiveItemKey("");
    setActiveMetadataCacheStatus(null);
    if (barcodeInputRef.current) {
      barcodeInputRef.current.value = "";
      barcodeInputRef.current.focus();
    }
  }, [userBranchCode]);

  const savePayloadAsPending = useCallback(
    async (payload, reason = "OFFLINE") => {
      const offlinePayload = clonePendingPayload({
        ...payload,
        actionSource: "DELIVER_PAGE_OFFLINE_PENDING",
      });
      const saved = await savePendingDispense({
        payload: offlinePayload,
        branchCode: toCleanText(payload?.branchCode),
        branchLabel: selectedBranchLabel,
        patient: { ...(payload?.patient || {}) },
        deliverNotesRaw: toCleanText(payload?.deliverNotesRaw),
        offlineReason: reason,
        offlineMetadata: {
          source: "DELIVER_METADATA_LOCAL_CACHE",
          capturedAt: new Date().toISOString(),
          cacheTtlMs: DELIVERY_METADATA_CACHE_TTL_MS,
          lines: (Array.isArray(offlinePayload.lines) ? offlinePayload.lines : []).map(
            (line) => ({
              productId: toCleanText(line?.productId),
              productCode: toCleanText(line?.productCode),
              reportType: toCleanText(line?.reportType).toUpperCase(),
              lotId: toCleanText(line?.lotId),
              lotNo: toCleanText(line?.lotNo),
              lotCachedAt: line?.metadataSnapshot?.lotCachedAt || null,
              lotSource: line?.metadataSnapshot?.lotSource || null,
            })
          ),
        },
        userSnapshot: {
          id: toCleanText(user?.id),
          username: toCleanText(user?.username),
          fullName: toCleanText(user?.fullName || user?.full_name),
          role: toCleanText(user?.role),
        },
      });
      await refreshPendingDispenses();
      return saved;
    },
    [refreshPendingDispenses, selectedBranchLabel, user]
  );

  const buildDispensePayload = useCallback(() => {
    if (!items.length) {
      return {
        payload: null,
        error: "ยังไม่มีรายการสินค้าที่จะส่งมอบ",
      };
    }

    const lines = [];
    const validationErrors = [];

    items.forEach((item, index) => {
      const productId = toCleanText(item?.id);
      const qty = Number(item?.qty);
      const unitLabel = toCleanText(item?.unit);
      const productCode = toCleanText(
        item?.productCode ?? item?.companyCode ?? item?.product_code ?? ""
      );
      const rowLabel = `รายการที่ ${index + 1}`;

      if (!productId) {
        validationErrors.push(`${rowLabel} ไม่มี productId`);
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        validationErrors.push(`${rowLabel} จำนวนต้องมากกว่า 0`);
        return;
      }
      if (!unitLabel) {
        validationErrors.push(`${rowLabel} ไม่มีหน่วย (unitLabel)`);
        return;
      }

      const reportType = toCleanText(item?.reportType || selectedReportType).toUpperCase();
      const lotCacheKey = buildLotCacheKey(productId, productCode, effectiveBranchCode);
      const cachedLotOptions = lotCacheKey
        ? lotOptionsCacheRef.current.get(lotCacheKey) || []
        : [];
      const lotMeta = lotCacheKey ? lotOptionsMetaCacheRef.current.get(lotCacheKey) || null : null;
      const lotId = toCleanText(item?.lotId);
      const lotNo = toCleanText(item?.lotNo);

      if (!SUPPORTED_REPORT_TYPES.has(reportType)) {
        validationErrors.push(`${rowLabel} กรุณาระบุประเภทรายงาน KY10/KY11 ก่อนยืนยัน`);
      }
      if (!lotId && !lotNo) {
        validationErrors.push(`${rowLabel} กรุณาเลือกเลข lot number ก่อนยืนยัน`);
      }

      lines.push({
        productId,
        productName: toCleanText(item?.name),
        productCode,
        qty,
        unitLabel,
        barcode: toCleanText(item?.barcode) || undefined,
        lotId: lotId || undefined,
        lotNo: lotNo || undefined,
        lotExpDate: toCleanText(item?.lotExpDate) || undefined,
        lotOptions: normalizeLotOptionsForPending(cachedLotOptions, item),
        price: Number(item?.price || 0),
        reportType: SUPPORTED_REPORT_TYPES.has(reportType) ? reportType : undefined,
        note: buildLineNote(item, reportType),
        metadataSnapshot: {
          source: isOnline ? "online-backend" : "offline-cache",
          lotCacheKey,
          lotSource: lotMeta?.source || null,
          lotCachedAt: lotMeta?.cachedAt || null,
          lotCacheStale: Boolean(lotMeta?.stale),
          reportGroupCodes: normalizeReportGroupCodes(item?.reportGroupCodes),
        },
      });
    });

    if (validationErrors.length) {
      return {
        payload: null,
        error: validationErrors.join(" / "),
      };
    }

    const patient = parsedNotes?.patient || {};
    const reportType = toCleanText(selectedReportType).toUpperCase();
    const branchCode = effectiveBranchCode;
    const patientName = toCleanText(patient?.fullName);
    const patientPid = toCleanText(patient?.pid);
    const hasRecipientNotes = Boolean(toCleanText(parsedNotes?.rawText));

    if (isAdmin) {
      if (isLoadingBranches) {
        return {
          payload: null,
          error: "กำลังโหลดรายการสาขา กรุณารอสักครู่",
        };
      }

      if (!branchCode) {
        return {
          payload: null,
          error: "กรุณาเลือกสาขาที่ทำรายการก่อนยืนยันการส่งมอบยา",
        };
      }
    }

    if (!hasRecipientNotes) {
      return {
        payload: null,
        error: "ต้องอ่านข้อมูลจาก smartcard ก่อนยืนยันการส่งมอบยา",
      };
    }

    if (!patientName) {
      return {
        payload: null,
        error: "ข้อมูล smartcard ยังไม่สมบูรณ์: ไม่พบชื่อผู้รับมอบยา",
      };
    }

    if (!hasCapturedSmartcardData) {
      return {
        payload: null,
        error: "ต้องอ่านข้อมูลจาก smartcard ก่อนยืนยันการส่งมอบยา",
      };
    }

    if (!patientPid) {
      return {
        payload: null,
        error: "ไม่พบเลขบัตรประชาชนจาก smartcard จึงยังไม่สามารถบันทึกการส่งมอบยาได้",
      };
    }

    return {
      payload: {
        branchCode,
        occurredAt: new Date().toISOString(),
        reportType: SUPPORTED_REPORT_TYPES.has(reportType) ? reportType : null,
        actionSource: "DELIVER_PAGE_FINAL",
        note: parsedNotes?.rawText || null,
        deliverNotesRaw: parsedNotes?.rawText || null,
        patient: {
          pid: toCleanText(patient?.pid) || null,
          fullName: toCleanText(patient?.fullName) || null,
          birthDate: patient?.birthDate || null,
          sex: patient?.sex || null,
          cardIssuePlace: toCleanText(patient?.cardIssuePlace) || null,
          cardIssuedDate: patient?.cardIssuedDate || null,
          cardExpiryDate: patient?.cardExpiryDate || null,
          addressText: toCleanText(patient?.addressText) || null,
        },
        lines,
      },
      error: "",
    };
  }, [
    effectiveBranchCode,
    hasCapturedSmartcardData,
    isAdmin,
    isOnline,
    isLoadingBranches,
    items,
    parsedNotes,
    selectedReportType,
    userBranchCode,
  ]);

  const resolveDispenseLinesForSubmit = useCallback(async (rawLines = []) => {
    const unitLookupCache = new Map();
    const resolvedLines = [];

    for (const [index, line] of rawLines.entries()) {
      const rowLabel = `รายการที่ ${index + 1}`;
      const productId = toCleanText(line?.productId);
      const lotId = toCleanText(line?.lotId);
      const lotNo = toCleanText(line?.lotNo);
      const lotExpDate = toCleanText(line?.lotExpDate || line?.expDate || line?.exp_date);
      const unitLabel = toCleanText(line?.unitLabel);
      const cacheKey = [productId, lotId || lotNo || "-", lotExpDate || "-"].join("|");

      let unitResponse = unitLookupCache.get(cacheKey);
      if (!unitResponse) {
        unitResponse = await productsApi.unitLevels(productId, {
          lotId: lotId || undefined,
          lotNo: lotId ? undefined : lotNo || undefined,
          expDate: lotId ? undefined : lotExpDate || undefined,
        });
        unitLookupCache.set(cacheKey, unitResponse || {});
      }

      const unitOptions = (Array.isArray(unitResponse?.items) ? unitResponse.items : [])
        .map(normalizeUnitLevelOption)
        .filter((option) => option.id && option.displayName);

      if (!unitOptions.length) {
        throw new Error(`${rowLabel} ไม่พบหน่วยสินค้าที่ใช้งานได้สำหรับ lot ที่เลือก`);
      }

      const matchedUnitOption = pickMatchingUnitLevelOption(
        unitOptions,
        line,
        toCleanText(unitResponse?.defaultUnitLevelId)
      );

      if (!matchedUnitOption) {
        throw new Error(`${rowLabel} หน่วย "${unitLabel || "-"}" ไม่สามารถใช้กับ lot นี้ได้`);
      }

      resolvedLines.push({
        ...line,
        unitLevelId: matchedUnitOption.id,
        unitLabel: matchedUnitOption.displayName,
      });
    }

    return resolvedLines;
  }, []);

  const handleOpenConfirmModal = useCallback(() => {
    setSubmitSuccess("");
    const { error } = buildDispensePayload();
    if (error) {
      setSubmitError(error);
      return;
    }
    setSubmitError("");
    setIsModalOpen(true);
  }, [buildDispensePayload]);

  const handleConfirmDispense = useCallback(async () => {
    if (isSubmitting) return;

    const { payload, error } = buildDispensePayload();
    if (error || !payload) {
      setSubmitError(error || "ข้อมูลไม่ครบถ้วน");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      if (!isOnline) {
        const pending = await savePayloadAsPending(payload, "BROWSER_OFFLINE");
        setSubmitSuccess(
          `บันทึกรายการรอส่งเข้าระบบแล้ว (${pending.localTxnId}) เมื่อเชื่อมต่ออีกครั้งให้ตรวจสอบและยืนยันรายการค้าง`
        );
        setIsModalOpen(false);
        resetDispenseForm();
        return;
      }

      const resolvedLines = await resolveDispenseLinesForSubmit(payload.lines);
      const response = await dispenseApi.create({
        ...payload,
        lines: resolvedLines,
      });
      const lineCount = Number(response?.lineCount || resolvedLines.length);
      const referenceId = toCleanText(response?.headerId);
      const successMessage = referenceId
        ? `บันทึกการส่งมอบสำเร็จ (${lineCount} รายการ) เลขอ้างอิง ${referenceId}`
        : `บันทึกการส่งมอบสำเร็จ (${lineCount} รายการ)`;

      setSubmitSuccess(successMessage);
      setIsModalOpen(false);
      resetDispenseForm();
    } catch (error) {
      if (isNetworkLikeError(error)) {
        try {
          const pending = await savePayloadAsPending(payload, error?.message || "NETWORK_ERROR");
          setSubmitSuccess(
            `เชื่อมต่อระบบไม่ได้ จึงบันทึกรายการรอส่งเข้าระบบแล้ว (${pending.localTxnId})`
          );
          setIsModalOpen(false);
          resetDispenseForm();
        } catch (queueError) {
          setSubmitError(
            queueError?.message ||
              "เชื่อมต่อระบบไม่ได้ และไม่สามารถบันทึกรายการค้างในเครื่องนี้ได้"
          );
        }
      } else {
        setSubmitError(error?.message || "บันทึกการส่งมอบไม่สำเร็จ");
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    buildDispensePayload,
    isOnline,
    isSubmitting,
    resetDispenseForm,
    resolveDispenseLinesForSubmit,
    savePayloadAsPending,
  ]);

  const handleSelectPendingReview = useCallback(
    (event) => {
      const localTxnId = toCleanText(event.target.value);
      const record = pendingDispenses.find((row) => row.localTxnId === localTxnId) || null;
      selectPendingReview(record);
    },
    [pendingDispenses, selectPendingReview]
  );

  const updatePendingReviewLine = useCallback((lineIndex, updater) => {
    setPendingReviewDraft((prev) => {
      if (!prev?.payload) return prev;
      const lines = Array.isArray(prev.payload.lines) ? prev.payload.lines : [];
      const nextLines = lines.map((line, index) => {
        if (index !== lineIndex) return line;
        const updatedLine =
          typeof updater === "function" ? updater({ ...line }) : { ...line, ...updater };
        return {
          ...updatedLine,
          note: buildLineNote(updatedLine, updatedLine.reportType),
        };
      });

      return {
        ...prev,
        payload: {
          ...prev.payload,
          lines: nextLines,
        },
      };
    });
  }, []);

  const handlePendingLineQtyChange = useCallback(
    (lineIndex, value) => {
      updatePendingReviewLine(lineIndex, { qty: value });
    },
    [updatePendingReviewLine]
  );

  const handlePendingLineReportTypeChange = useCallback(
    (lineIndex, value) => {
      updatePendingReviewLine(lineIndex, {
        reportType: toCleanText(value).toUpperCase(),
      });
    },
    [updatePendingReviewLine]
  );

  const handlePendingLineLotChange = useCallback(
    (lineIndex, lotId) => {
      updatePendingReviewLine(lineIndex, (line) => {
        const safeLotId = toCleanText(lotId);
        const lotOptions = normalizeLotOptionsForPending(line?.lotOptions, line);
        const matchedLot =
          lotOptions.find((option) => toCleanText(option?.lotId) === safeLotId) || null;
        return {
          ...line,
          lotId: safeLotId || undefined,
          lotNo: safeLotId ? toCleanText(matchedLot?.lotNo) || undefined : undefined,
          lotExpDate: safeLotId ? toCleanText(matchedLot?.expDate) || undefined : undefined,
          lotOptions,
        };
      });
    },
    [updatePendingReviewLine]
  );

  const handleRemovePendingLine = useCallback((lineIndex) => {
    setPendingReviewDraft((prev) => {
      if (!prev?.payload) return prev;
      const lines = Array.isArray(prev.payload.lines) ? prev.payload.lines : [];
      return {
        ...prev,
        payload: {
          ...prev.payload,
          lines: lines.filter((_line, index) => index !== lineIndex),
        },
      };
    });
  }, []);

  const buildPendingPayloadForSubmit = useCallback(() => {
    const draftPayload = clonePendingPayload(pendingReviewDraft?.payload || {});
    const lines = Array.isArray(draftPayload.lines) ? draftPayload.lines : [];
    const validationErrors = [];
    const normalizedLines = lines.map((line, index) => {
      const rowLabel = `รายการค้างที่ ${index + 1}`;
      const productId = toCleanText(line?.productId);
      const qty = Number(line?.qty);
      const unitLabel = toCleanText(line?.unitLabel);
      const reportType = toCleanText(line?.reportType).toUpperCase();
      const lotId = toCleanText(line?.lotId);
      const lotNo = toCleanText(line?.lotNo);

      if (!productId) validationErrors.push(`${rowLabel} ไม่มี productId`);
      if (!Number.isFinite(qty) || qty <= 0) {
        validationErrors.push(`${rowLabel} จำนวนต้องมากกว่า 0`);
      }
      if (!unitLabel) validationErrors.push(`${rowLabel} ไม่มีหน่วย`);
      if (!SUPPORTED_REPORT_TYPES.has(reportType)) {
        validationErrors.push(`${rowLabel} ไม่มีประเภทรายงาน KY10/KY11`);
      }
      if (!lotId && !lotNo) {
        validationErrors.push(`${rowLabel} ไม่มีเลข lot number`);
      }

      return {
        productId,
        productName: toCleanText(line?.productName),
        productCode: toCleanText(line?.productCode),
        qty,
        unitLabel,
        barcode: toCleanText(line?.barcode) || undefined,
        lotId: lotId || undefined,
        lotNo: lotNo || undefined,
        lotExpDate: toCleanText(line?.lotExpDate) || undefined,
        reportType: SUPPORTED_REPORT_TYPES.has(reportType) ? reportType : undefined,
        note: buildLineNote(line, reportType),
      };
    });

    if (!normalizedLines.length) {
      validationErrors.push("ต้องมีรายการยาอย่างน้อย 1 รายการ");
    }

    const patient = draftPayload.patient || {};
    if (!toCleanText(patient?.pid)) {
      validationErrors.push("ข้อมูลบัตรไม่ครบ: ไม่พบเลขประจำตัวประชาชน");
    }
    if (!toCleanText(patient?.fullName)) {
      validationErrors.push("ข้อมูลบัตรไม่ครบ: ไม่พบชื่อผู้รับมอบยา");
    }

    if (validationErrors.length) {
      return { payload: null, error: validationErrors.join(" / ") };
    }

    return {
      payload: {
        ...draftPayload,
        actionSource: "DELIVER_PAGE_OFFLINE_SYNC",
        lines: normalizedLines,
      },
      error: "",
    };
  }, [pendingReviewDraft]);

  const handleConfirmPendingDispense = useCallback(async () => {
    if (isSyncingPending) return;
    const localTxnId = toCleanText(pendingReviewDraft?.localTxnId || pendingReviewId);
    if (!localTxnId) {
      setPendingReviewError("ไม่พบรายการค้างที่เลือก");
      return;
    }
    if (!isOnline) {
      setPendingReviewError("ยังอยู่ในโหมดออฟไลน์ ต้องเชื่อมต่อก่อนยืนยันรายการค้าง");
      return;
    }

    const { payload, error } = buildPendingPayloadForSubmit();
    if (error || !payload) {
      setPendingReviewError(error || "ข้อมูลรายการค้างไม่ครบถ้วน");
      return;
    }

    setIsSyncingPending(true);
    setPendingReviewError("");
    try {
      await updatePendingDispense(localTxnId, {
        payload: clonePendingPayload({
          ...(pendingReviewDraft?.payload || {}),
          actionSource: "DELIVER_PAGE_OFFLINE_PENDING",
        }),
      });
      const resolvedLines = await resolveDispenseLinesForSubmit(payload.lines);
      const response = await dispenseApi.create({
        ...payload,
        lines: resolvedLines,
      });
      await removePendingDispense(localTxnId);
      const rows = await refreshPendingDispenses();
      const lineCount = Number(response?.lineCount || resolvedLines.length);
      const referenceId = toCleanText(response?.headerId);
      setSubmitError("");
      setSubmitSuccess(
        referenceId
          ? `ยืนยันรายการค้างสำเร็จ (${lineCount} รายการ) เลขอ้างอิง ${referenceId}`
          : `ยืนยันรายการค้างสำเร็จ (${lineCount} รายการ)`
      );
      if (!rows.length) {
        setIsPendingModalOpen(false);
      }
    } catch (error) {
      setPendingReviewError(error?.message || "ยืนยันรายการค้างไม่สำเร็จ");
    } finally {
      setIsSyncingPending(false);
    }
  }, [
    buildPendingPayloadForSubmit,
    isOnline,
    isSyncingPending,
    pendingReviewDraft,
    pendingReviewId,
    refreshPendingDispenses,
    resolveDispenseLinesForSubmit,
  ]);

  const handleCancelPendingDispense = useCallback(async () => {
    const localTxnId = toCleanText(pendingReviewDraft?.localTxnId || pendingReviewId);
    if (!localTxnId || isSyncingPending) return;

    setIsSyncingPending(true);
    setPendingReviewError("");
    try {
      await removePendingDispense(localTxnId);
      const rows = await refreshPendingDispenses();
      setSubmitError("");
      setSubmitSuccess(`ยกเลิกรายการค้าง ${localTxnId} แล้ว`);
      if (!rows.length) {
        setIsPendingModalOpen(false);
      }
    } catch (error) {
      setPendingReviewError(error?.message || "ยกเลิกรายการค้างไม่สำเร็จ");
    } finally {
      setIsSyncingPending(false);
    }
  }, [isSyncingPending, pendingReviewDraft, pendingReviewId, refreshPendingDispenses]);

  const grandTotal = useMemo(() => {
    return items.reduce((sum, item) => sum + item.qty * item.price, 0);
  }, [items]);

  const pendingReviewPayload = pendingReviewDraft?.payload || {};
  const pendingReviewLines = Array.isArray(pendingReviewPayload.lines)
    ? pendingReviewPayload.lines
    : [];
  const pendingReviewPatient = pendingReviewPayload.patient || {};
  const pendingReviewTotal = useMemo(() => {
    return pendingReviewLines.reduce(
      (sum, line) => sum + Number(line?.qty || 0) * Number(line?.price || 0),
      0
    );
  }, [pendingReviewLines]);

  const handleModalBackdrop = useCallback(
    (event) => {
      if (isSubmitting) return;
      if (event.target === event.currentTarget) {
        setIsModalOpen(false);
      }
    },
    [isSubmitting]
  );

  const handleOpenIncidentModal = useCallback(() => {
    const patient = parsedNotes?.patient || {};
    const recipientName = toCleanText(patient?.fullName);
    const hasPatientIdentity =
      Boolean(toCleanText(patient?.pid)) && Boolean(recipientName);
    const defaultResolutionActionType = hasPatientIdentity
      ? "RETROSPECTIVE_DISPENSE"
      : "STOCK_OUT";
    const incidentType = hasCapturedSmartcardData ? "PROCESS_DEVIATION" : "SMARTCARD_EXCEPTION";
    const incidentReason = hasCapturedSmartcardData
      ? "STAFF_PROCESS_MISSED"
      : "DISPENSE_BEFORE_SMARTCARD";

    setSubmitError("");
    setIncidentModalSeed({
      incidentType,
      incidentReason,
      status: "ACKNOWLEDGED",
      branchCode: effectiveBranchCode || "",
      happenedAt: new Date().toISOString(),
      incidentDescription: [
        "สร้างจากหน้า Deliver เพื่อบันทึกเหตุผิดปกติแยกจาก dispense",
        `สถานะ smartcard: ${hasCapturedSmartcardData ? "อ่านข้อมูลแล้ว" : "ยังไม่มีข้อมูลจาก smartcard"}`,
        `ผู้รับมอบยาที่เห็นในหน้าจอ: ${recipientName || "-"}`,
        `ประเภทรายงาน: ${selectedReportType || "-"}`,
      ].join("\n"),
      note: [
        `สาขาที่เกี่ยวข้อง: ${selectedBranchLabel}`,
        `จำนวนรายการยาในหน้าจอ: ${items.length}`,
      ].join("\n"),
      items: items.map((item) => ({
        productId: toCleanText(item?.id),
        lotId: toCleanText(item?.lotId),
        lotNoSnapshot: toCleanText(item?.lotNo),
        expDateSnapshot: toCleanText(item?.lotExpDate),
        qty: Number(item?.qty || 0),
        unitLabel: toCleanText(item?.unit),
      })),
      defaultResolutionActionType,
      resolutionActions: items.map((item) => ({
        actionType: defaultResolutionActionType,
        productId: toCleanText(item?.id),
        lotId: toCleanText(item?.lotId),
        lotNoSnapshot: toCleanText(item?.lotNo),
        expDateSnapshot: toCleanText(item?.lotExpDate),
        qty: Number(item?.qty || 0),
        unitLabel: toCleanText(item?.unit),
        note: `สร้าง corrective action จากหน้า Deliver (${selectedReportType || "-"})`,
      })),
      resolutionPatient: {
        pid: toCleanText(patient?.pid),
        fullName: recipientName,
        englishName: toCleanText(patient?.englishName),
        birthDate: patient?.birthDate || "",
        sex: patient?.sex || "",
        cardIssuePlace: toCleanText(patient?.cardIssuePlace),
        cardIssuedDate: patient?.cardIssuedDate || "",
        cardExpiryDate: patient?.cardExpiryDate || "",
        addressText: toCleanText(patient?.addressText),
      },
    });
    setIsIncidentModalOpen(true);
  }, [
    effectiveBranchCode,
    hasCapturedSmartcardData,
    items,
    parsedNotes,
    selectedBranchLabel,
    selectedReportType,
  ]);

  const canConfirm = items.length > 0 && !isSubmitting;
  const canOpenProductSearch = !isLoadingBranches && (!isAdmin || Boolean(effectiveBranchCode));
  const canConfirmProductSearchSelection =
    Boolean(selectedDeliverSearchProduct) && !isLoadingDeliverSearchProducts;

  return (
    <>
      <style>{`
        #pos-main-page .pos-left {
          padding-bottom: 320px;
        }

        @media (max-width: 768px) {
          #pos-main-page .pos-left {
            padding-bottom: 350px;
          }
        }

        @media (max-width: 480px) {
          #pos-main-page .pos-left {
            padding-bottom: 370px;
          }
        }
      `}</style>
      <div
        id="pos-main-page"
        className="rx1011-form-container"
        data-section="pos"
        style={{ marginBottom: "640px" }}
      >
        <section className="pos-section">
          <div className="wrap">
            <div id="posGuard" className="pos-alert hidden">
              ยังกรอกแบบสอบถามไม่ครบ -
              <button id="resumeFormBtn" type="button">
                ไปทำแบบสอบถามต่อ
              </button>
            </div>

            {submitError ? (
              <div className="pos-feedback pos-feedback--error">{submitError}</div>
            ) : null}
            {submitSuccess ? (
              <div className="pos-feedback pos-feedback--success">{submitSuccess}</div>
            ) : null}
            {!isOnline || pendingDispenses.length || pendingLoadError ? (
              <div className={`pos-offline-status${isOnline ? "" : " is-offline"}`}>
                <div>
                  <strong>{isOnline ? "เชื่อมต่อระบบแล้ว" : "โหมดออฟไลน์"}</strong>
                  <span>
                    {isOnline
                      ? pendingDispenses.length
                        ? ` มีรายการรอส่งเข้าระบบ ${pendingDispenses.length} รายการ`
                        : " ไม่มีรายการค้างในเครื่องนี้"
                      : " รายการส่งมอบจะถูกพักไว้ในเครื่องนี้จนกว่าจะเชื่อมต่ออีกครั้ง"}
                  </span>
                  {pendingLoadError ? (
                    <div className="pos-offline-status__error">{pendingLoadError}</div>
                  ) : null}
                </div>
                {pendingDispenses.length ? (
                  <button
                    type="button"
                    className="pos-offline-status__button"
                    onClick={() => {
                      void refreshPendingDispenses({ openWhenOnline: true });
                    }}
                  >
                    ตรวจรายการค้าง
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="pos-panel">
              <div className="pos-left">
                <div className="pos-table">
                  <div className="thead">
                    <div>ลำดับที่</div>
                    <div className="thead-barcode">บาร์โค้ด</div>
                    <div className="thead-product-name">รายการสินค้า</div>
                    <div className="hide-md">รหัสสินค้า</div>
                    <div className="amount">จำนวน</div>
                    <div className="note-bin">NOTE</div>
                  </div>
                  <div className="tbody" id="items">
                    {items.map((item, index) => (
                      <div
                        key={getItemIdentity(item) || `${item.name}-${item.barcode}-${index}`}
                        data-name={item.name}
                        className={
                          getItemIdentity(item) === activeItemKey
                            ? "pos-item-row is-active"
                            : "pos-item-row"
                        }
                        onClick={() => {
                          void handleActivateItem(item);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void handleActivateItem(item);
                          }
                        }}
                      >
                        <div className="item-index">{index + 1}</div>
                        <div className="item-barcode">{item.barcode}</div>
                        <div className="item-name">{item.name}</div>
                        <div className="item-company">{item.companyCode}</div>
                        <div className="item-qty">{item.qty}</div>
                        <div className="item-note">
                          <button
                            className="item-delete"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDelete(item);
                            }}
                            aria-label="Delete item"
                            data-name={item.name}
                          >
                            <svg
                              className="icon-trash"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM7 9h2v9H7V9Zm-1 12h12a2 2 0 0 0 2-2V8H4v11a2 2 0 0 0 2 2Z"></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pos-bottomstack">
                  <div className="pos-inputbar">
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input
                        ref={barcodeInputRef}
                        id="barcode-input-field"
                        type="text"
                        placeholder="พิมพ์จำนวน -> กด 'คูณ (*)' หรือ PageDown -> สแกน/พิมพ์บาร์โค้ด/รหัสสินค้า IC แล้วกด Enter"
                        autoComplete="off"
                        onKeyDown={handleBarcodeKeyDown}
                      />
                      <span
                        className={`mult${pendingMultiplier ? " is-active" : ""}`}
                        id="multChip"
                        aria-live="polite"
                      >
                        {pendingMultiplier ? `x${pendingMultiplier}` : ""}
                      </span>
                    </div>
                    <div className="total">
                      <span id="grand">{toMoney(grandTotal)}</span> บาท
                    </div>
                  </div>

                  <div className="pos-notes-block">
                    <div className="pos-notes-grid">
                      <div className="pos-notes-column">
                        <label className="pos-notes-label" htmlFor="deliver-notes">
                          ลูกค้าที่รับมอบยา
                        </label>
                        <textarea
                          id="deliver-notes"
                          className="pos-notes-textarea"
                          placeholder="ข้อมูลผู้รับมอบยาจะถูกกรอกจาก smartcard เท่านั้น"
                          rows={4}
                          value={deliverNotes}
                          readOnly
                          aria-readonly="true"
                          spellCheck={false}
                        />
                        <div
                          className={`pos-notes-help pos-notes-help--smartcard${
                            smartcardStatus.tone === "error"
                              ? " pos-notes-help--error"
                              : smartcardStatus.tone === "warn"
                              ? " pos-notes-help--warn"
                              : smartcardStatus.tone === "success"
                              ? " pos-notes-help--success"
                              : ""
                          }`}
                        >
                          {smartcardStatus.message}
                        </div>

                        <div className="pos-smartcard-policy">
                          <div className="pos-smartcard-policy__title">Smartcard policy</div>
                          <div className="pos-notes-help">
                            ทุกบทบาทต้องอ่านข้อมูลจาก smartcard ก่อนยืนยันการส่งมอบยา
                            หากไม่มีบัตรหรือข้อมูลบัตรไม่ครบ ระบบจะไม่ finalize รายการนี้
                          </div>
                          <div className="pos-smartcard-policy__status">
                            <strong>สถานะ smartcard:</strong>{" "}
                            {hasCapturedSmartcardData ? "อ่านข้อมูลแล้ว" : "ยังไม่มีข้อมูลจาก smartcard"}
                          </div>
                        </div>
                      </div>

                      <div className="pos-notes-column pos-notes-column--meta">
                        <div className="pos-notes-active-product">
                          สินค้าที่กำลังกำหนด lot/report: {selectedProductName || "-"}
                        </div>
                        <div className="pos-notes-field">
                          <label className="pos-notes-label" htmlFor="deliver-report-type">
                            ประเภทรายงาน
                          </label>
                          <select
                            id="deliver-report-type"
                            className="pos-notes-select"
                            value={selectedReportType}
                            onChange={handleReportTypeChange}
                          >
                            <option value="">
                              {selectedProductName
                                ? "ไม่พบประเภทรายงาน (KY10/KY11) สำหรับสินค้านี้"
                                : "สแกนสินค้าเพื่อดึงประเภทรายงานอัตโนมัติ"}
                            </option>
                            {reportTypeOptions.map((option) => (
                              <option key={option.code} value={option.code}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="pos-notes-field">
                          <label className="pos-notes-label" htmlFor="deliver-lot-number">
                            เลข lot number
                          </label>
                          <select
                            id="deliver-lot-number"
                            className="pos-notes-select"
                            value={selectedLotId}
                            onChange={handleLotSelectionChange}
                          >
                            <option value="">
                              {selectedProductName
                                ? isAdmin && !effectiveBranchCode
                                  ? "เลือกสาขาที่ทำรายการก่อนดึง lot"
                                  : lotOptions.length
                                  ? "เลือก lot ที่มี stock ในสาขาที่กำลังทำรายการ"
                                  : "ไม่พบ lot ที่เคยรับเข้า/คงเหลือสำหรับสินค้านี้"
                                : "สแกนสินค้าเพื่อดึงเลข lot อัตโนมัติ"}
                            </option>
                            {lotOptions.map((option) => {
                              const optionLotId = toCleanText(option?.lotId);
                              if (!optionLotId) return null;
                              const expLabel = toDateLabel(option?.expDate);
                              const lotLabel = toCleanText(option?.lotNo) || optionLotId;
                              return (
                                <option
                                  key={optionLotId}
                                  value={optionLotId}
                                >
                                  {expLabel ? `${lotLabel} (exp ${expLabel})` : lotLabel}
                                </option>
                              );
                            })}
                          </select>
                        </div>

                        {activeMetadataCacheMessage ? (
                          <div
                            className={`pos-notes-help pos-notes-cache-status${
                              activeMetadataCacheStatus?.source === "server"
                                ? " pos-notes-help--success"
                                : activeMetadataCacheStatus?.source === "cache" &&
                                  !activeMetadataCacheStatus?.stale
                                ? ""
                                : " pos-notes-help--warn"
                            }`}
                          >
                            {activeMetadataCacheMessage}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <aside className="pos-rail">
                <div
                  className="coupon"
                  id="couponBox"
                  role="button"
                  tabIndex={0}
                  onClick={handleCouponClick}
                  onKeyDown={handleCouponKeyDown}
                >
                  คูณ ( * )<br />
                  <small>PAGE DOWN</small>
                </div>

                <button
                  className="btn pos-search-btn"
                  type="button"
                  onClick={handleOpenProductSearchModal}
                  disabled={!canOpenProductSearch}
                  title={
                    canOpenProductSearch
                      ? "ค้นหารายการยา ขย.10 ทั้งหมด และ ขย.11 ที่มี TRAMADOL"
                      : "กรุณาเลือกสาขาที่ทำรายการก่อนค้นหายา"
                  }
                >
                  ค้นหายา
                </button>

                <button
                  className="btn btn-primary"
                  id="pos-confirmBtn"
                  type="button"
                  onClick={handleOpenConfirmModal}
                  disabled={!canConfirm}
                  title={items.length ? "" : "ยังไม่มีรายการสินค้า"}
                >
                  {isSubmitting
                    ? "กำลังบันทึก..."
                    : isOnline
                    ? "ยืนยันการทำรายการ"
                    : "บันทึกรายการรอส่ง"}
                </button>

                <button
                  className="btn pos-pending-trigger"
                  type="button"
                  onClick={() => {
                    void refreshPendingDispenses({ openWhenOnline: true });
                  }}
                  disabled={!pendingDispenses.length}
                >
                  รายการค้าง ({pendingDispenses.length})
                </button>

                {isAdmin ? (
                  <button
                    className="btn pos-incident-trigger"
                    type="button"
                    onClick={handleOpenIncidentModal}
                    disabled={isSubmitting}
                  >
                    รายงานเหตุผิดปกติ
                  </button>
                ) : null}

                <div className="pos-rail-field">
                  <label className="pos-notes-label" htmlFor="deliver-branch-code">
                    สาขาที่ทำรายการ
                  </label>
                  {isAdmin ? (
                    <select
                      id="deliver-branch-code"
                      className="pos-notes-select"
                      value={selectedBranchCode}
                      onChange={(event) => setSelectedBranchCode(toCleanText(event.target.value))}
                      disabled={isLoadingBranches}
                    >
                      <option value="">
                        {isLoadingBranches ? "กำลังโหลดรายการสาขา..." : "เลือกสาขาที่ทำรายการ"}
                      </option>
                      {branchOptions.map((branch) => (
                        <option key={branch.id || branch.code} value={branch.code}>
                          {branch.code}
                          {branch.name ? ` : ${branch.name}` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="pos-notes-readonly">{selectedBranchLabel}</div>
                  )}
                  {branchLoadError ? (
                    <div className="pos-notes-help pos-notes-help--error">{branchLoadError}</div>
                  ) : null}
                  {!isAdmin ? (
                    <div className="pos-notes-help">ระบบใช้สาขาตามสิทธิ์ผู้ใช้โดยอัตโนมัติ</div>
                  ) : null}
                </div>
              </aside>
            </div>
          </div>
        </section>
      </div>

      {isModalOpen ? (
        <div
          id="posMyModal"
          className="pos-modal"
          aria-hidden="false"
          onClick={handleModalBackdrop}
        >
          <div className="pos-confirm-dialog" role="dialog" aria-modal="true">
            <h2 className="pos-confirm-title">ยืนยันการทำรายการส่งมอบยา</h2>
            <p className="pos-confirm-body">
              {isOnline
                ? "เมื่อยืนยันแล้ว ระบบจะบันทึกการจ่ายยาและตัดสต็อกทันทีแบบถาวร ต้องการดำเนินการต่อหรือไม่"
                : "ขณะนี้เป็นโหมดออฟไลน์ ระบบจะพักรายการนี้ไว้ในเครื่อง และให้ตรวจสอบอีกครั้งเมื่อเชื่อมต่อระบบได้"}
            </p>

            <div className="pos-confirm-summary">
              <div>จำนวนรายการยา: {items.length} รายการ</div>
              <div>ยอดรวม: {toMoney(grandTotal)} บาท</div>
              <div>สาขาที่ทำรายการ: {selectedBranchLabel}</div>
              <div>ประเภทรายงาน: {selectedReportType || "-"}</div>
              <div>Smartcard: {hasCapturedSmartcardData ? "อ่านข้อมูลแล้ว" : "ไม่มีข้อมูลในรายการนี้"}</div>
              <div>
                ผู้รับมอบยา: {toCleanText(parsedNotes?.patient?.fullName) || "-"}
              </div>
            </div>

            <div className="pos-confirm-actions">
              <button
                type="button"
                className="btn pos-confirm-cancel"
                onClick={() => setIsModalOpen(false)}
                disabled={isSubmitting}
              >
                ปิด
              </button>
              <button
                type="button"
                className="btn btn-primary pos-confirm-submit"
                onClick={() => {
                  void handleConfirmDispense();
                }}
                disabled={isSubmitting}
              >
                {isSubmitting ? "กำลังยืนยัน..." : isOnline ? "ยืนยัน" : "บันทึกรายการค้าง"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AdminIncidentModal
        open={isIncidentModalOpen}
        initialValues={incidentModalSeed}
        title="รายงานเหตุผิดปกติจากหน้า Deliver"
        onClose={() => setIsIncidentModalOpen(false)}
        onCreated={(incident) => {
          setIsIncidentModalOpen(false);
          setSubmitError("");
          setSubmitSuccess(
            `บันทึก incident report สำเร็จ (${toCleanText(incident?.incidentCode) || toCleanText(incident?.id) || "-"})`
          );
        }}
      />

      {isPendingModalOpen ? (
        <div
          className="pos-modal"
          aria-hidden="false"
          onClick={(event) => {
            if (event.target === event.currentTarget && !isSyncingPending) {
              setIsPendingModalOpen(false);
            }
          }}
        >
          <div
            className="pos-pending-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deliver-pending-title"
          >
            <div className="pos-pending-header">
              <div>
                <h2 className="pos-confirm-title" id="deliver-pending-title">
                  รายการส่งมอบที่รอเข้าระบบ
                </h2>
                <p className="pos-confirm-body">
                  ตรวจสอบข้อมูลจาก smartcard และแก้ได้เฉพาะจำนวนยา รายการยาในบิล และเลข lot ก่อนยืนยันส่งเข้าระบบ
                </p>
              </div>
              <div className={`pos-pending-online${isOnline ? " is-online" : " is-offline"}`}>
                {isOnline ? "ออนไลน์" : "ออฟไลน์"}
              </div>
            </div>

            {pendingLoadError ? (
              <div className="pos-feedback pos-feedback--error pos-search-feedback">
                {pendingLoadError}
              </div>
            ) : null}
            {pendingReviewError ? (
              <div className="pos-feedback pos-feedback--error pos-search-feedback">
                {pendingReviewError}
              </div>
            ) : null}

            {pendingDispenses.length ? (
              <div className="pos-pending-selector">
                <label className="pos-notes-label" htmlFor="pending-dispense-select">
                  เลือกรายการค้าง
                </label>
                <select
                  id="pending-dispense-select"
                  className="pos-notes-select"
                  value={pendingReviewId}
                  onChange={handleSelectPendingReview}
                  disabled={isSyncingPending}
                >
                  {pendingDispenses.map((record) => (
                    <option key={record.localTxnId} value={record.localTxnId}>
                      {record.localTxnId} - {record.branchLabel || record.branchCode || "-"} -{" "}
                      {record.patient?.fullName || record.payload?.patient?.fullName || "-"}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="pos-search-empty">ไม่มีรายการค้างในเครื่องนี้</div>
            )}

            {pendingReviewDraft ? (
              <>
                <div className="pos-pending-summary">
                  <div>
                    <strong>เลขรายการ:</strong> {pendingReviewDraft.localTxnId}
                  </div>
                  <div>
                    <strong>บันทึกเมื่อ:</strong>{" "}
                    {pendingReviewDraft.createdAt
                      ? new Date(pendingReviewDraft.createdAt).toLocaleString("th-TH")
                      : "-"}
                  </div>
                  <div>
                    <strong>สาขา:</strong>{" "}
                    {pendingReviewDraft.branchLabel || pendingReviewPayload.branchCode || "-"}
                  </div>
                  <div>
                    <strong>ผู้ทำรายการ:</strong>{" "}
                    {pendingReviewDraft.userSnapshot?.fullName ||
                      pendingReviewDraft.userSnapshot?.username ||
                      "-"}
                  </div>
                  <div>
                    <strong>ยอดรวมโดยประมาณ:</strong> {toMoney(pendingReviewTotal)} บาท
                  </div>
                </div>

                <section className="pos-pending-patient">
                  <h3>ข้อมูลผู้เสียบบัตร</h3>
                  <div className="pos-pending-patient-grid">
                    <div>
                      <span>ชื่อผู้รับมอบยา</span>
                      <strong>{toCleanText(pendingReviewPatient.fullName) || "-"}</strong>
                    </div>
                    <div>
                      <span>เลขประจำตัวประชาชน</span>
                      <strong>{toCleanText(pendingReviewPatient.pid) || "-"}</strong>
                    </div>
                    <div>
                      <span>วันเกิด</span>
                      <strong>{toDateLabel(pendingReviewPatient.birthDate) || "-"}</strong>
                    </div>
                    <div>
                      <span>เพศ</span>
                      <strong>{toCleanText(pendingReviewPatient.sex) || "-"}</strong>
                    </div>
                    <div className="pos-pending-patient-address">
                      <span>ที่อยู่</span>
                      <strong>{toCleanText(pendingReviewPatient.addressText) || "-"}</strong>
                    </div>
                  </div>
                  <pre className="pos-pending-raw-card">
                    {toCleanText(pendingReviewPayload.deliverNotesRaw) ||
                      toCleanText(pendingReviewDraft.deliverNotesRaw) ||
                      "-"}
                  </pre>
                </section>

                <section className="pos-pending-lines">
                  <h3>รายการยา</h3>
                  <div className="pos-pending-line-head">
                    <div>ยา</div>
                    <div>จำนวน</div>
                    <div>ประเภทรายงาน</div>
                    <div>เลข lot</div>
                    <div>จัดการ</div>
                  </div>
                  {pendingReviewLines.length ? (
                    pendingReviewLines.map((line, index) => {
                      const lineLotOptions = normalizeLotOptionsForPending(line?.lotOptions, line);
                      return (
                        <div
                          className="pos-pending-line-row"
                          key={`${line?.productId || line?.productCode || "line"}-${index}`}
                        >
                          <div className="pos-pending-line-product">
                            <strong>{line?.productName || "-"}</strong>
                            <span>
                              {line?.productCode || "-"} / {line?.unitLabel || "-"}
                            </span>
                          </div>
                          <div>
                            <input
                              className="pos-pending-qty-input"
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={line?.qty ?? ""}
                              onChange={(event) =>
                                handlePendingLineQtyChange(index, event.target.value)
                              }
                              disabled={isSyncingPending}
                            />
                          </div>
                          <div>
                            <select
                              className="pos-notes-select"
                              value={toCleanText(line?.reportType).toUpperCase()}
                              onChange={(event) =>
                                handlePendingLineReportTypeChange(index, event.target.value)
                              }
                              disabled={isSyncingPending}
                            >
                              <option value="">เลือกประเภทรายงาน</option>
                              {Object.entries(REPORT_TYPE_META).map(([code, label]) => (
                                <option key={code} value={code}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <select
                              className="pos-notes-select"
                              value={toCleanText(line?.lotId)}
                              onChange={(event) =>
                                handlePendingLineLotChange(index, event.target.value)
                              }
                              disabled={isSyncingPending || !lineLotOptions.length}
                            >
                              <option value="">
                                {lineLotOptions.length ? "ไม่ระบุ lot" : "ไม่มีตัวเลือก lot ใน cache"}
                              </option>
                              {lineLotOptions.map((option) => {
                                const optionLotId = toCleanText(option?.lotId);
                                if (!optionLotId) return null;
                                const lotLabel = toCleanText(option?.lotNo) || optionLotId;
                                const expLabel = toDateLabel(option?.expDate);
                                return (
                                  <option key={optionLotId} value={optionLotId}>
                                    {expLabel ? `${lotLabel} (exp ${expLabel})` : lotLabel}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                          <div>
                            <button
                              type="button"
                              className="pos-pending-remove-line"
                              onClick={() => handleRemovePendingLine(index)}
                              disabled={isSyncingPending}
                            >
                              ลบ
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="pos-search-empty">รายการนี้ยังไม่มีรายการยา</div>
                  )}
                </section>
              </>
            ) : null}

            <div className="pos-confirm-actions pos-pending-actions">
              <button
                type="button"
                className="btn pos-confirm-cancel"
                onClick={() => setIsPendingModalOpen(false)}
                disabled={isSyncingPending}
              >
                ปิด
              </button>
              <button
                type="button"
                className="btn pos-pending-danger"
                onClick={() => {
                  void handleCancelPendingDispense();
                }}
                disabled={!pendingReviewDraft || isSyncingPending}
              >
                ยกเลิกรายการ
              </button>
              <button
                type="button"
                className="btn btn-primary pos-confirm-submit"
                onClick={() => {
                  void handleConfirmPendingDispense();
                }}
                disabled={!pendingReviewDraft || isSyncingPending || !isOnline}
              >
                {isSyncingPending ? "กำลังยืนยัน..." : "ยืนยันการทำรายการ"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isProductSearchModalOpen ? (
        <div
          className="pos-modal"
          aria-hidden="false"
          onClick={handleProductSearchModalBackdrop}
        >
          <div className="pos-search-dialog" role="dialog" aria-modal="true" aria-labelledby="deliver-product-search-title">
            <div className="pos-search-header">
              <div>
                <div className="pos-search-title-row">
                  <h2 className="pos-search-title" id="deliver-product-search-title">
                    ค้นหายา
                  </h2>
                  <div className="pos-search-controls">
                    <input
                      className="pos-search-input"
                      type="search"
                      value={deliverSearchDraft}
                      onChange={(event) => setDeliverSearchDraft(event.target.value)}
                      onKeyDown={handleDeliverSearchInputKeyDown}
                      placeholder="บาร์โค้ด / IC / ชื่อยา / ตัวยาสำคัญ"
                      disabled={isLoadingDeliverSearchProducts}
                      aria-label="ค้นหายาด้วยบาร์โค้ด รหัสสินค้า ชื่อยา หรือตัวยาสำคัญ"
                    />
                    <button
                      type="button"
                      className="pos-search-submit-button"
                      onClick={handleCommitDeliverSearchTerm}
                      disabled={isLoadingDeliverSearchProducts}
                    >
                      ค้นหา
                    </button>
                  </div>
                </div>
                <p className="pos-search-body">
                  แสดงเฉพาะรายการ ขย.10 ทั้งหมด และรายการ ขย.11 ที่มีตัวยาสำคัญ TRAMADOL ของสาขา {selectedBranchLabel}
                </p>
              </div>
            </div>

            {deliverSearchLoadError ? (
              <div className="pos-feedback pos-feedback--error pos-search-feedback">
                {deliverSearchLoadError}
              </div>
            ) : null}

            <div className="pos-search-table" role="region" aria-label="รายการยาที่เลือกได้">
              <div className="pos-search-table-head">
                <div>รหัสสินค้า</div>
                <div>ชื่อสินค้า</div>
                <div>จำนวนคงเหลือในสต็อก</div>
              </div>
              <div className="pos-search-table-body">
                {isLoadingDeliverSearchProducts ? (
                  <div className="pos-search-empty">กำลังโหลดรายการยา...</div>
                ) : visibleDeliverSearchProducts.length ? (
                  visibleDeliverSearchProducts.map((product) => {
                    const isSelected = product.id === selectedDeliverSearchProductId;
                    const category = getDeliverSearchCategory(product);
                    return (
                      <div
                        key={product.id}
                        className={`pos-search-row${isSelected ? " is-selected" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedDeliverSearchProductId(product.id)}
                        onDoubleClick={() => {
                          void commitDeliverSearchSelection(product);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void commitDeliverSearchSelection(product);
                            return;
                          }
                          if (event.key === " ") {
                            event.preventDefault();
                            setSelectedDeliverSearchProductId(product.id);
                          }
                        }}
                      >
                        <div className="pos-search-code">{product.productCode || "-"}</div>
                        <div className="pos-search-name">
                          <div>{product.name || "-"}</div>
                          <div className="pos-search-tags">
                            <span
                              className={`pos-search-tag${
                                category.code === "KY10" ? " is-ky10" : " is-ky11"
                              }`}
                            >
                              {category.label}
                            </span>
                            <span className="pos-search-tag-detail">{category.description}</span>
                          </div>
                        </div>
                        <div className="pos-search-stock">
                          {formatQuantityAsUnits(product.quantityBase, product.baseUnitLabel || product.unit)}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="pos-search-empty">
                    {deliverSearchProducts.length
                      ? "ไม่พบรายการยาที่ตรงกับคำค้น"
                      : "ไม่พบรายการยาที่ตรงเงื่อนไขในสาขานี้"}
                  </div>
                )}
              </div>
            </div>

            <div className="pos-confirm-actions">
              <button
                type="button"
                className="btn pos-confirm-cancel"
                onClick={handleCloseProductSearchModal}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn btn-primary pos-confirm-submit"
                onClick={() => {
                  void commitDeliverSearchSelection();
                }}
                disabled={!canConfirmProductSearchSelection}
              >
                ตกลง
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
