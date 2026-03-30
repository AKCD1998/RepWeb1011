import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { INVENTORY_CHANGED_EVENT, inventoryApi, productsApi } from "../lib/api";
import "./Receiving.css";

const MOVEMENT_TYPE_OPTIONS = [
  { value: "RECEIVE", label: "รับเข้า" },
  { value: "TRANSFER_OUT", label: "โอนออก" },
  { value: "DISPENSE", label: "ส่งมอบลูกค้า" },
];

const MOVEMENT_TYPE_LABEL = {
  RECEIVE: "รับเข้า",
  TRANSFER_OUT: "โอนออก",
  TRANSFER_IN: "รับโอน",
  DISPENSE: "ส่งมอบลูกค้า",
};

const SUPPORTED_TABLE_TYPES = new Set(["RECEIVE", "TRANSFER_OUT", "TRANSFER_IN", "DISPENSE"]);
const PRODUCT_SEARCH_LIMIT = 20;
const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const BANGKOK_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: BANGKOK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getBangkokDateTimeParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = Object.fromEntries(
    BANGKOK_DATE_TIME_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function toDateTimeLocalValue(date = new Date()) {
  const parts = getBangkokDateTimeParts(date);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function toDateTimeLocalInputValue(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return toDateTimeLocalValue(date);
}

function formatOccurredAtDisplay(value) {
  if (!value) return "-";
  const parts = getBangkokDateTimeParts(value);
  if (!parts) {
    return String(value).replace("T", " ");
  }
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatQty(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value || "-");
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(3).replace(/\.?0+$/, "");
}

function toCleanText(value) {
  return String(value || "").trim();
}

function normalizeDateOnly(value) {
  const text = toCleanText(value);
  if (!text) return "";

  const matchedDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (matchedDate?.[1]) {
    return matchedDate[1];
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  return date.toISOString().slice(0, 10);
}

function getLotOptionValue(lotNo, expDate) {
  const safeLotNo = toCleanText(lotNo);
  const safeExpDate = normalizeDateOnly(expDate);
  if (!safeLotNo || !safeExpDate) return "";
  return `${safeLotNo}||${safeExpDate}`;
}

function mapTransferLotOptions(rows) {
  const seen = new Set();
  const list = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const lotId = toCleanText(row?.lotId || row?.lot_id);
      const lotNo = toCleanText(row?.lotNo || row?.lot_no);
      const expDate = normalizeDateOnly(row?.expDate || row?.exp_date);
      const quantity = Number(row?.quantityBase ?? row?.quantity ?? 0);

      return {
        lotId,
        lotNo,
        expDate,
        quantity: Number.isFinite(quantity) ? quantity : 0,
      };
    })
    .filter((option) => option.lotNo && option.expDate)
    .filter((option) => {
      const key = option.lotId || getLotOptionValue(option.lotNo, option.expDate);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  list.sort((left, right) => {
    if (left.expDate !== right.expDate) {
      return left.expDate.localeCompare(right.expDate);
    }
    return left.lotNo.localeCompare(right.lotNo);
  });

  return list;
}

function buildTransferLotOptionLabel(option) {
  const lotNo = toCleanText(option?.lotNo) || "-";
  const expDate = normalizeDateOnly(option?.expDate) || "-";
  const qtyText = Number.isFinite(Number(option?.quantity))
    ? ` • คงเหลือ ${formatQty(option.quantity)}`
    : "";
  return `${lotNo} (exp ${expDate}${qtyText})`;
}

function normalizeRole(value) {
  return toCleanText(value).toUpperCase();
}

function buildLocationLabel(location) {
  const code = toCleanText(location?.code);
  const name = toCleanText(location?.name);
  if (code && name) return `${code} : ${name}`;
  return code || name || toCleanText(location?.id) || "-";
}

function getLockedLocations(movementType, branchLocationId, isAdmin) {
  if (isAdmin) {
    return {
      fromLocationId: "",
      toLocationId: "",
    };
  }

  if (movementType === "RECEIVE") {
    return {
      fromLocationId: "",
      toLocationId: branchLocationId,
    };
  }

  if (movementType === "TRANSFER_OUT") {
    return {
      fromLocationId: branchLocationId,
      toLocationId: "",
    };
  }

  if (movementType === "DISPENSE") {
    return {
      fromLocationId: branchLocationId,
      toLocationId: "",
    };
  }

  return {
    fromLocationId: "",
    toLocationId: "",
  };
}

function createInitialMovementForm({ isAdmin, branchLocationId }) {
  const locked = getLockedLocations("RECEIVE", branchLocationId, isAdmin);
  return {
    movementType: "RECEIVE",
    fromLocationId: locked.fromLocationId || "",
    toLocationId: locked.toLocationId || "",
    productSearch: "",
    productId: "",
    productName: "",
    productCode: "",
    unitLevelId: "",
    qty: "",
    unit: "",
    lotNo: "",
    expDate: "",
  };
}

function createInitialOccurredAtCorrectionForm(movement) {
  const initialOccurredAt =
    movement?.correctedOccurredAtRaw || movement?.occurredAtRaw || movement?.originalOccurredAtRaw;

  return {
    correctedOccurredAt: toDateTimeLocalInputValue(initialOccurredAt || new Date()),
    reason: "",
  };
}

function mapMovementRecord(row) {
  const parsedQuantity = Number(row?.quantity ?? row?.qtyValue ?? 0);
  const parsedQuantityBase = Number(row?.quantityBase);
  const occurredAtRaw = toCleanText(row?.occurredAt);
  const originalOccurredAtRaw = toCleanText(row?.originalOccurredAt || row?.occurredAt);
  const correctedOccurredAtRaw = toCleanText(row?.correctedOccurredAt);
  const correctionEditedAtRaw = toCleanText(row?.occurredAtCorrectedAt);
  return {
    id: row?.id || `row-${Math.random().toString(36).slice(2)}`,
    occurredAt: formatOccurredAtDisplay(occurredAtRaw),
    occurredAtRaw,
    originalOccurredAt: formatOccurredAtDisplay(originalOccurredAtRaw),
    originalOccurredAtRaw,
    correctedOccurredAt: formatOccurredAtDisplay(correctedOccurredAtRaw),
    correctedOccurredAtRaw,
    productName: row?.tradeName || row?.productName || "-",
    productCode: row?.productCode || "-",
    lotNo: row?.lotNo || "-",
    movementType: String(row?.movementType || "").toUpperCase(),
    qtyValue: Number.isFinite(parsedQuantity) ? parsedQuantity : 0,
    qtyBaseValue: Number.isFinite(parsedQuantityBase) ? parsedQuantityBase : null,
    unit: String(row?.unitLabel || row?.unit || "").trim(),
    movementUnit: String(row?.movementUnitLabel || "").trim(),
    baseUnitLabel: String(row?.baseUnitLabel || "").trim(),
    occurredAtCorrectionReason: toCleanText(row?.occurredAtCorrectionReason),
    occurredAtCorrectedAt: formatOccurredAtDisplay(correctionEditedAtRaw),
    occurredAtCorrectedAtRaw: correctionEditedAtRaw,
    occurredAtCorrectedByName: toCleanText(row?.occurredAtCorrectedByName),
    occurredAtCorrectedByUsername: toCleanText(row?.occurredAtCorrectedByUsername),
    isOccurredAtCorrected: Boolean(correctedOccurredAtRaw),
  };
}

function isPositiveMovement(movementType) {
  return movementType === "RECEIVE" || movementType === "TRANSFER_IN";
}

function getMovementTypeClass(movementType) {
  if (movementType === "RECEIVE") return "movement-type-receive";
  if (movementType === "TRANSFER_OUT") return "movement-type-transfer";
  if (movementType === "DISPENSE") return "movement-type-dispense";
  return "movement-type-unknown";
}

function getDeltaClass(movementType) {
  return isPositiveMovement(movementType) ? "delta-positive" : "delta-negative";
}

function normalizeInlineText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePackDetail(unitLabel) {
  const normalized = normalizeInlineText(unitLabel);
  if (!normalized) return null;

  const match = normalized.match(/^1\s+(.+?)\s*[xX×]\s*(.+)$/u);
  if (!match) return null;

  const containerUnit = normalizeInlineText(match[1]);
  const detail = normalizeInlineText(match[2]);
  if (!containerUnit || !detail) return null;

  return {
    containerUnit,
    packDetail: `${detail}/${containerUnit}`,
  };
}

function getDeltaText(movement) {
  const qtyText = formatQty(movement?.qtyValue);
  const unit = String(movement?.unit || "").trim();
  const sign = isPositiveMovement(movement?.movementType) ? "+" : "-";
  const primaryText = `${sign}${qtyText}${unit ? ` ${unit}` : ""}`;

  const quantityBaseValue = Number(movement?.qtyBaseValue);
  if (!Number.isFinite(quantityBaseValue)) return primaryText;

  const baseQtyText = formatQty(Math.abs(quantityBaseValue));
  const baseUnitLabel = String(movement?.baseUnitLabel || "").trim();
  const shouldShowBase =
    baseQtyText !== qtyText || (baseUnitLabel && baseUnitLabel.toLowerCase() !== unit.toLowerCase());

  if (!shouldShowBase) return primaryText;
  return `${primaryText} (${sign}${baseQtyText}${baseUnitLabel ? ` ${baseUnitLabel}` : ""} ฐาน)`;
}

function formatDeltaCompact(movement) {
  const sign = isPositiveMovement(movement?.movementType) ? "+" : "-";
  const qtyValue = Number(movement?.qtyValue);
  const qtyText = formatQty(Number.isFinite(qtyValue) ? Math.abs(qtyValue) : movement?.qtyValue);
  const signedQty = qtyText === "-" ? "-" : `${sign}${qtyText}`;

  const movementUnitRaw = normalizeInlineText(movement?.movementUnit);
  const unitLabelRaw = normalizeInlineText(movement?.unit);
  const movementPackMeta = parsePackDetail(movementUnitRaw);
  const unitPackMeta = parsePackDetail(unitLabelRaw);

  const movementUnit = movementPackMeta?.containerUnit || movementUnitRaw;
  const unitLabel = unitPackMeta?.containerUnit || unitLabelRaw;
  const packDetail = unitPackMeta?.packDetail || movementPackMeta?.packDetail;
  const displayUnit = movementUnit || unitLabel;

  let compactText = `${signedQty}${displayUnit ? ` ${displayUnit}` : ""}`.trim();
  if (packDetail) {
    compactText = `${compactText} (${packDetail})`;
  }

  const quantityBaseValue = Number(movement?.qtyBaseValue);
  if (!Number.isFinite(quantityBaseValue)) return compactText;

  const baseQtyText = formatQty(Math.abs(quantityBaseValue));
  const baseUnitLabel = normalizeInlineText(movement?.baseUnitLabel);
  const shouldShowBase =
    baseQtyText !== qtyText || (baseUnitLabel && baseUnitLabel.toLowerCase() !== displayUnit.toLowerCase());

  if (!shouldShowBase) return compactText;

  const signedBaseQty = `${sign}${baseQtyText}`;
  const shouldShowBaseUnit = baseUnitLabel && baseUnitLabel.toLowerCase() !== displayUnit.toLowerCase();
  return `${compactText} • ฐาน ${signedBaseQty}${shouldShowBaseUnit ? ` ${baseUnitLabel}` : ""}`;
}

function getDeltaTitle(movement) {
  const fullDeltaText = getDeltaText(movement);
  const movementUnit = normalizeInlineText(movement?.movementUnit);
  const unit = normalizeInlineText(movement?.unit);

  if (!movementUnit || movementUnit.toLowerCase() === unit.toLowerCase()) {
    return fullDeltaText;
  }

  return `${fullDeltaText}\nหน่วยที่บันทึกในรายการเดิม: ${movementUnit}`;
}

function getOccurredAtCorrectionActorLabel(movement) {
  return (
    toCleanText(movement?.occurredAtCorrectedByName) ||
    toCleanText(movement?.occurredAtCorrectedByUsername) ||
    "-"
  );
}

function getOccurredAtTitle(movement) {
  const effectiveOccurredAt = toCleanText(movement?.occurredAt) || "-";

  if (!movement?.isOccurredAtCorrected) {
    return effectiveOccurredAt;
  }

  const lines = [
    `เวลาแสดงผล: ${effectiveOccurredAt}`,
    `เวลาต้นฉบับ: ${toCleanText(movement?.originalOccurredAt) || "-"}`,
  ];

  if (toCleanText(movement?.occurredAtCorrectedAt)) {
    lines.push(`แก้ล่าสุดเมื่อ: ${movement.occurredAtCorrectedAt}`);
  }
  const correctedBy = getOccurredAtCorrectionActorLabel(movement);
  if (correctedBy !== "-") {
    lines.push(`ผู้แก้ล่าสุด: ${correctedBy}`);
  }
  if (toCleanText(movement?.occurredAtCorrectionReason)) {
    lines.push(`เหตุผล: ${movement.occurredAtCorrectionReason}`);
  }

  return lines.join("\n");
}

export default function Receiving() {
  const { user } = useAuth();
  const userRole = normalizeRole(user?.role);
  const isAdmin = userRole === "ADMIN";
  const branchLocationId = toCleanText(user?.location_id);
  const userBranchCode = toCleanText(user?.branchCode || user?.branch_code);

  const [movements, setMovements] = useState([]);
  const [locations, setLocations] = useState([]);
  const [isLoadingMovements, setIsLoadingMovements] = useState(false);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [isOccurredAtCorrectionModalOpen, setIsOccurredAtCorrectionModalOpen] = useState(false);
  const [isSavingMovement, setIsSavingMovement] = useState(false);
  const [isSavingOccurredAtCorrection, setIsSavingOccurredAtCorrection] = useState(false);
  const [isSearchingProduct, setIsSearchingProduct] = useState(false);
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [productSearchError, setProductSearchError] = useState("");
  const [locationLoadError, setLocationLoadError] = useState("");
  const [movementForm, setMovementForm] = useState(() =>
    createInitialMovementForm({ isAdmin, branchLocationId })
  );
  const [movementCorrectionTarget, setMovementCorrectionTarget] = useState(null);
  const [occurredAtCorrectionForm, setOccurredAtCorrectionForm] = useState(() =>
    createInitialOccurredAtCorrectionForm(null)
  );
  const [occurredAtCorrectionErrors, setOccurredAtCorrectionErrors] = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [pageError, setPageError] = useState("");
  const [productSearchStatus, setProductSearchStatus] = useState("");
  const [productUnitOptions, setProductUnitOptions] = useState([]);
  const [isLoadingProductUnits, setIsLoadingProductUnits] = useState(false);
  const [productUnitLoadError, setProductUnitLoadError] = useState("");
  const [transferLotOptions, setTransferLotOptions] = useState([]);
  const [isLoadingTransferLots, setIsLoadingTransferLots] = useState(false);
  const [transferLotLoadError, setTransferLotLoadError] = useState("");
  const productUnitRequestSeqRef = useRef(0);
  const transferLotRequestSeqRef = useRef(0);

  const tableColumns = ["เวลา", "สินค้า", "รหัสสินค้า", "Lot", "ประเภท", "การเปลี่ยนแปลงสต๊อก"];
  const totalText = useMemo(() => `รวม ${movements.length} รายการ`, [movements.length]);
  const locationMap = useMemo(() => {
    return new Map(
      locations.map((location) => {
        const id = toCleanText(location?.id);
        return [id, location];
      })
    );
  }, [locations]);
  const locationOptions = useMemo(() => {
    return locations.filter((location) => toCleanText(location?.id));
  }, [locations]);

  const lockedLocations = useMemo(() => {
    return getLockedLocations(movementForm.movementType, branchLocationId, isAdmin);
  }, [movementForm.movementType, branchLocationId, isAdmin]);

  const isFromLocked = Boolean(lockedLocations.fromLocationId);
  const isToLocked = Boolean(lockedLocations.toLocationId);
  const showToLocationField = movementForm.movementType !== "DISPENSE";
  const isFromRequired =
    movementForm.movementType === "TRANSFER_OUT" || movementForm.movementType === "DISPENSE";
  const isToRequired =
    movementForm.movementType === "RECEIVE" || movementForm.movementType === "TRANSFER_OUT";
  const effectiveFromLocationId = isFromLocked
    ? lockedLocations.fromLocationId
    : toCleanText(movementForm.fromLocationId);
  const effectiveToLocationId = showToLocationField
    ? isToLocked
      ? lockedLocations.toLocationId
      : toCleanText(movementForm.toLocationId)
    : "";
  const isTransferOutMovement = movementForm.movementType === "TRANSFER_OUT";
  const fromLocation = locationMap.get(effectiveFromLocationId) || null;
  const fromLocationType = normalizeRole(fromLocation?.type);
  const effectiveFromBranchCode =
    fromLocationType === "BRANCH"
      ? toCleanText(fromLocation?.code)
      : effectiveFromLocationId && effectiveFromLocationId === branchLocationId
      ? userBranchCode
      : "";
  const selectedTransferLotValue = getLotOptionValue(movementForm.lotNo, movementForm.expDate);

  const getLocationLabel = useCallback(
    (locationId) => {
      const id = toCleanText(locationId);
      if (!id) return "-";
      const location = locationMap.get(id);
      if (!location) return `ID: ${id}`;
      return buildLocationLabel(location);
    },
    [locationMap]
  );

  const loadMovements = useCallback(async () => {
    if (!isAdmin && !branchLocationId) {
      setMovements([]);
      return;
    }

    setIsLoadingMovements(true);
    try {
      const rows = await inventoryApi.listMovements({
        location_id: isAdmin ? undefined : branchLocationId,
        limit: 100,
      });
      const normalized = (Array.isArray(rows) ? rows : [])
        .map(mapMovementRecord)
        .filter((row) => SUPPORTED_TABLE_TYPES.has(row.movementType));
      setMovements(normalized);
      setPageError("");
    } catch (error) {
      setPageError(error?.message || "ไม่สามารถโหลดข้อมูลการเคลื่อนไหวได้");
    } finally {
      setIsLoadingMovements(false);
    }
  }, [branchLocationId, isAdmin]);

  const loadLocations = useCallback(async () => {
    setIsLoadingLocations(true);
    try {
      const rows = await inventoryApi.listLocations({ includeInactive: false });
      const normalized = (Array.isArray(rows) ? rows : [])
        .map((row) => ({
          id: toCleanText(row?.id),
          code: toCleanText(row?.code),
          name: toCleanText(row?.name),
          type: toCleanText(row?.type || row?.location_type),
          isActive: row?.is_active !== false && row?.isActive !== false,
        }))
        .filter((row) => row.id);
      setLocations(normalized);
      setLocationLoadError("");
    } catch (error) {
      setLocationLoadError(error?.message || "ไม่สามารถโหลดรายการสถานที่ได้");
      setLocations([]);
    } finally {
      setIsLoadingLocations(false);
    }
  }, []);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  useEffect(() => {
    function handleInventoryChanged() {
      void loadMovements();
    }

    window.addEventListener(INVENTORY_CHANGED_EVENT, handleInventoryChanged);
    return () => window.removeEventListener(INVENTORY_CHANGED_EVENT, handleInventoryChanged);
  }, [loadMovements]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  useEffect(() => {
    if (!isMovementModalOpen && !isOccurredAtCorrectionModalOpen) return undefined;

    function handleEscape(event) {
      if (event.key === "Escape") {
        if (isOccurredAtCorrectionModalOpen) {
          closeOccurredAtCorrectionModal();
          return;
        }
        closeMovementModal();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isMovementModalOpen, isOccurredAtCorrectionModalOpen]);

  function resetTransferLotLookup() {
    transferLotRequestSeqRef.current += 1;
    setTransferLotOptions([]);
    setTransferLotLoadError("");
    setIsLoadingTransferLots(false);
  }

  function openMovementModal() {
    if (!isAdmin && !branchLocationId) {
      setPageError("ไม่พบ location_id ของผู้ใช้ กรุณาเข้าสู่ระบบใหม่");
      return;
    }

    if (!locationOptions.length && !isLoadingLocations) {
      void loadLocations();
    }

    setMovementForm(createInitialMovementForm({ isAdmin, branchLocationId }));
    setFormErrors({});
    setProductSearchResults([]);
    setProductSearchError("");
    setProductSearchStatus("");
    productUnitRequestSeqRef.current += 1;
    setProductUnitOptions([]);
    setProductUnitLoadError("");
    setIsLoadingProductUnits(false);
    resetTransferLotLookup();
    setIsMovementModalOpen(true);
  }

  function closeMovementModal() {
    productUnitRequestSeqRef.current += 1;
    setProductUnitOptions([]);
    setProductUnitLoadError("");
    setIsLoadingProductUnits(false);
    resetTransferLotLookup();
    setIsMovementModalOpen(false);
  }

  function openOccurredAtCorrectionModal(movement) {
    if (!isAdmin || !movement || movement.movementType !== "RECEIVE") {
      return;
    }

    setMovementCorrectionTarget(movement);
    setOccurredAtCorrectionForm(createInitialOccurredAtCorrectionForm(movement));
    setOccurredAtCorrectionErrors({});
    setPageError("");
    setIsOccurredAtCorrectionModalOpen(true);
  }

  function closeOccurredAtCorrectionModal() {
    setMovementCorrectionTarget(null);
    setOccurredAtCorrectionForm(createInitialOccurredAtCorrectionForm(null));
    setOccurredAtCorrectionErrors({});
    setIsOccurredAtCorrectionModalOpen(false);
  }

  useEffect(() => {
    function clearTransferLotSelection() {
      setMovementForm((prev) => {
        if (!toCleanText(prev.lotNo) && !normalizeDateOnly(prev.expDate)) {
          return prev;
        }
        return {
          ...prev,
          lotNo: "",
          expDate: "",
        };
      });
    }

    const productId = toCleanText(movementForm.productId);
    if (!isMovementModalOpen || !isTransferOutMovement) {
      resetTransferLotLookup();
      return;
    }

    if (!productId) {
      resetTransferLotLookup();
      clearTransferLotSelection();
      return;
    }

    if (!effectiveFromLocationId) {
      resetTransferLotLookup();
      clearTransferLotSelection();
      return;
    }

    if (!effectiveFromBranchCode) {
      resetTransferLotLookup();
      setTransferLotLoadError("สถานที่ต้นทางต้องเป็นสาขาเพื่อดึง lot อัตโนมัติ");
      clearTransferLotSelection();
      return;
    }

    transferLotRequestSeqRef.current += 1;
    const requestSeq = transferLotRequestSeqRef.current;
    const currentLotValue = getLotOptionValue(movementForm.lotNo, movementForm.expDate);

    setIsLoadingTransferLots(true);
    setTransferLotLoadError("");
    setTransferLotOptions([]);

    void inventoryApi
      .listStockOnHand({
        branchCode: effectiveFromBranchCode,
        productId,
      })
      .then((rows) => {
        if (requestSeq !== transferLotRequestSeqRef.current) return;

        const nextOptions = mapTransferLotOptions(rows);
        setTransferLotOptions(nextOptions);

        if (!nextOptions.length) {
          setTransferLotLoadError("ไม่พบ lot คงเหลือของสินค้านี้ที่สาขาต้นทาง");
          setMovementForm((prev) => {
            if (prev.movementType !== "TRANSFER_OUT" || toCleanText(prev.productId) !== productId) {
              return prev;
            }
            if (!toCleanText(prev.lotNo) && !normalizeDateOnly(prev.expDate)) {
              return prev;
            }
            return {
              ...prev,
              lotNo: "",
              expDate: "",
            };
          });
          return;
        }

        const matchedOption =
          nextOptions.find(
            (option) => getLotOptionValue(option.lotNo, option.expDate) === currentLotValue
          ) || nextOptions[0];

        setMovementForm((prev) => {
          if (prev.movementType !== "TRANSFER_OUT" || toCleanText(prev.productId) !== productId) {
            return prev;
          }

          const nextLotNo = toCleanText(matchedOption?.lotNo);
          const nextExpDate = normalizeDateOnly(matchedOption?.expDate);
          if (
            toCleanText(prev.lotNo) === nextLotNo &&
            normalizeDateOnly(prev.expDate) === nextExpDate
          ) {
            return prev;
          }

          return {
            ...prev,
            lotNo: nextLotNo,
            expDate: nextExpDate,
          };
        });
        setFormErrors((prev) => ({
          ...prev,
          lotNo: "",
          expDate: "",
        }));
      })
      .catch((error) => {
        if (requestSeq !== transferLotRequestSeqRef.current) return;
        setTransferLotOptions([]);
        setTransferLotLoadError(error?.message || "โหลดรายการ lot จากฐานข้อมูลไม่สำเร็จ");
        setMovementForm((prev) => {
          if (prev.movementType !== "TRANSFER_OUT" || toCleanText(prev.productId) !== productId) {
            return prev;
          }
          if (!toCleanText(prev.lotNo) && !normalizeDateOnly(prev.expDate)) {
            return prev;
          }
          return {
            ...prev,
            lotNo: "",
            expDate: "",
          };
        });
      })
      .finally(() => {
        if (requestSeq === transferLotRequestSeqRef.current) {
          setIsLoadingTransferLots(false);
        }
      });
  }, [
    effectiveFromBranchCode,
    effectiveFromLocationId,
    isMovementModalOpen,
    isTransferOutMovement,
    movementForm.productId,
  ]);

  function setField(field, value) {
    setMovementForm((prev) => ({
      ...prev,
      [field]: value,
    }));
    setFormErrors((prev) => ({
      ...prev,
      [field]: "",
    }));
  }

  function handleFromLocationChange(event) {
    const nextFromLocationId = event.target.value;
    if (!isTransferOutMovement) {
      setField("fromLocationId", nextFromLocationId);
      return;
    }

    resetTransferLotLookup();
    setMovementForm((prev) => ({
      ...prev,
      fromLocationId: nextFromLocationId,
      lotNo: "",
      expDate: "",
    }));
    setFormErrors((prev) => ({
      ...prev,
      fromLocationId: "",
      lotNo: "",
      expDate: "",
    }));
  }

  function setOccurredAtCorrectionField(field, value) {
    setOccurredAtCorrectionForm((prev) => ({
      ...prev,
      [field]: value,
    }));
    setOccurredAtCorrectionErrors((prev) => ({
      ...prev,
      [field]: "",
    }));
  }

  const loadProductUnitOptions = useCallback(async (productId, preferredUnitLabel = "") => {
    const normalizedProductId = toCleanText(productId);
    productUnitRequestSeqRef.current += 1;
    const requestSeq = productUnitRequestSeqRef.current;

    if (!normalizedProductId) {
      setProductUnitOptions([]);
      setMovementForm((prev) => ({
        ...prev,
        unitLevelId: "",
        unit: "",
      }));
      setProductUnitLoadError("");
      setIsLoadingProductUnits(false);
      return;
    }

    setIsLoadingProductUnits(true);
    setProductUnitLoadError("");
    try {
      const response = await productsApi.unitLevels(normalizedProductId);
      if (requestSeq !== productUnitRequestSeqRef.current) return;

      const rows = Array.isArray(response?.items)
        ? response.items
        : Array.isArray(response)
        ? response
        : [];
      const options = rows
        .map((row) => ({
          id: toCleanText(row?.id),
          displayName: toCleanText(row?.displayName || row?.display_name || row?.code),
          isSellable: Boolean(row?.isSellable ?? row?.is_sellable),
          sortOrder: Number(row?.sortOrder ?? row?.sort_order ?? 0),
          quantityPerBase: Number(row?.quantityPerBase ?? row?.quantity_per_base),
        }))
        .filter((row) => row.id && row.displayName)
        .sort((a, b) => {
          const aQpb = Number.isFinite(a.quantityPerBase) ? a.quantityPerBase : Number.POSITIVE_INFINITY;
          const bQpb = Number.isFinite(b.quantityPerBase) ? b.quantityPerBase : Number.POSITIVE_INFINITY;
          if (aQpb !== bQpb) return aQpb - bQpb;
          return a.sortOrder - b.sortOrder;
        });

      setProductUnitOptions(options);

      if (!options.length) {
        setMovementForm((prev) => ({
          ...prev,
          unitLevelId: "",
          unit: "",
        }));
        setFormErrors((prev) => ({
          ...prev,
          unit: "ไม่พบหน่วยของสินค้านี้ใน product_unit_levels",
        }));
        setProductUnitLoadError("ไม่พบหน่วยของสินค้านี้ใน product_unit_levels");
        return;
      }

      const nextUnitOption = options[0];

      setMovementForm((prev) => ({
        ...prev,
        unitLevelId: nextUnitOption.id,
        unit: nextUnitOption.displayName,
      }));
      setFormErrors((prev) => ({
        ...prev,
        unit: "",
      }));
    } catch (error) {
      if (requestSeq !== productUnitRequestSeqRef.current) return;
      setProductUnitOptions([]);
      setMovementForm((prev) => ({
        ...prev,
        unitLevelId: "",
        unit: "",
      }));
      setProductUnitLoadError(error?.message || "โหลดรายการหน่วยไม่สำเร็จ");
    } finally {
      if (requestSeq === productUnitRequestSeqRef.current) {
        setIsLoadingProductUnits(false);
      }
    }
  }, []);

  function handleProductSearchInputChange(event) {
    const keyword = event.target.value;
    productUnitRequestSeqRef.current += 1;
    resetTransferLotLookup();
    setMovementForm((prev) => ({
      ...prev,
      productSearch: keyword,
      productId: "",
      productName: "",
      productCode: "",
      unitLevelId: "",
      unit: "",
      lotNo: "",
      expDate: "",
    }));
    setProductSearchResults([]);
    setProductSearchError("");
    setProductSearchStatus("");
    setProductUnitOptions([]);
    setProductUnitLoadError("");
    setIsLoadingProductUnits(false);
    setFormErrors((prev) => ({
      ...prev,
      productId: "",
      unit: "",
      lotNo: "",
      expDate: "",
    }));
  }

  function handleSelectProduct(product) {
    resetTransferLotLookup();
    setMovementForm((prev) => ({
      ...prev,
      productId: product.id,
      productName: product.tradeName,
      productCode: product.productCode,
      unitLevelId: "",
      unit: "",
      lotNo: "",
      expDate: "",
    }));
    setProductSearchError("");
    setProductSearchStatus(`เลือกสินค้าแล้ว: ${product.tradeName}`);
    setProductUnitLoadError("");
    setFormErrors((prev) => ({
      ...prev,
      productId: "",
      unit: "",
      lotNo: "",
      expDate: "",
    }));
    void loadProductUnitOptions(product.id, product.packageSize || product.unitSymbol);
  }

  function handleMovementTypeChange(event) {
    const nextType = event.target.value;
    resetTransferLotLookup();
    setMovementForm((prev) => {
      const previousLocked = getLockedLocations(prev.movementType, branchLocationId, isAdmin);
      const nextLocked = getLockedLocations(nextType, branchLocationId, isAdmin);

      const nextFromLocationId = nextLocked.fromLocationId
        ? nextLocked.fromLocationId
        : previousLocked.fromLocationId
        ? ""
        : prev.fromLocationId;
      const nextToLocationId =
        nextType === "DISPENSE"
          ? ""
          : nextLocked.toLocationId
          ? nextLocked.toLocationId
          : previousLocked.toLocationId
          ? ""
          : prev.toLocationId;

      return {
        ...prev,
        movementType: nextType,
        fromLocationId: nextFromLocationId,
        toLocationId: nextToLocationId,
        lotNo: "",
        expDate: "",
      };
    });
    setFormErrors((prev) => ({
      ...prev,
      movementType: "",
      fromLocationId: "",
      toLocationId: "",
      lotNo: "",
      expDate: "",
    }));
  }

  function handleUnitChange(event) {
    const nextUnitLevelId = toCleanText(event.target.value);
    const selectedOption = productUnitOptions.find((option) => option.id === nextUnitLevelId);

    setMovementForm((prev) => ({
      ...prev,
      unitLevelId: nextUnitLevelId,
      unit: selectedOption?.displayName || "",
    }));
    setFormErrors((prev) => ({
      ...prev,
      unit: "",
    }));
  }

  function handleTransferLotChange(event) {
    const nextValue = toCleanText(event.target.value);
    const selectedOption =
      transferLotOptions.find(
        (option) => getLotOptionValue(option.lotNo, option.expDate) === nextValue
      ) || null;

    setMovementForm((prev) => ({
      ...prev,
      lotNo: toCleanText(selectedOption?.lotNo),
      expDate: normalizeDateOnly(selectedOption?.expDate),
    }));
    setFormErrors((prev) => ({
      ...prev,
      lotNo: "",
      expDate: "",
    }));
  }

  async function handleProductSearch() {
    const keyword = String(movementForm.productSearch || "").trim();
    if (!keyword) {
      setProductSearchResults([]);
      setProductSearchError("");
      setProductSearchStatus("กรุณากรอกคำค้นหาสินค้า");
      setFormErrors((prev) => ({
        ...prev,
        productId: "กรุณาค้นหาและเลือกสินค้า",
      }));
      return;
    }

    setIsSearchingProduct(true);
    setProductSearchError("");
    setProductSearchStatus("");
    setProductSearchResults([]);
    try {
      const rows = await productsApi.list(keyword);
      const list = (Array.isArray(rows) ? rows : [])
        .slice(0, PRODUCT_SEARCH_LIMIT)
        .map((row) => ({
          id: String(row?.id || "").trim(),
          tradeName: String(row?.tradeName || row?.productName || "-"),
          productCode: String(row?.productCode || row?.product_code || "-"),
          barcode: String(row?.barcode || "-"),
          manufacturerName: String(row?.manufacturerName || "-"),
          packageSize: String(row?.packageSize || row?.package_size || ""),
          unitSymbol: String(row?.unitSymbol || ""),
        }))
        .filter((row) => row.id);

      if (!list.length) {
        productUnitRequestSeqRef.current += 1;
        resetTransferLotLookup();
        setProductSearchStatus("ไม่พบสินค้าที่ตรงกับคำค้นหา");
        setMovementForm((prev) => ({
          ...prev,
          productId: "",
          productName: "",
          productCode: "",
          unitLevelId: "",
          unit: "",
          lotNo: "",
          expDate: "",
        }));
        setProductUnitOptions([]);
        setProductUnitLoadError("");
        setIsLoadingProductUnits(false);
        setFormErrors((prev) => ({
          ...prev,
          productId: "กรุณาค้นหาและเลือกสินค้า",
          unit: "",
          lotNo: "",
          expDate: "",
        }));
        return;
      }

      productUnitRequestSeqRef.current += 1;
      resetTransferLotLookup();
      setMovementForm((prev) => ({
        ...prev,
        productId: "",
        productName: "",
        productCode: "",
        unitLevelId: "",
        unit: "",
        lotNo: "",
        expDate: "",
      }));
      setProductUnitOptions([]);
      setProductUnitLoadError("");
      setIsLoadingProductUnits(false);
      setProductSearchResults(list);
      setProductSearchStatus(`พบ ${list.length} รายการ โปรดเลือกสินค้า 1 รายการ`);
      setFormErrors((prev) => ({
        ...prev,
        productId: "กรุณาเลือกสินค้า 1 รายการจากผลค้นหา",
        unit: "",
        lotNo: "",
        expDate: "",
      }));
    } catch (error) {
      productUnitRequestSeqRef.current += 1;
      resetTransferLotLookup();
      setMovementForm((prev) => ({
        ...prev,
        productId: "",
        productName: "",
        productCode: "",
        unitLevelId: "",
        unit: "",
        lotNo: "",
        expDate: "",
      }));
      setProductUnitOptions([]);
      setProductUnitLoadError("");
      setIsLoadingProductUnits(false);
      setProductSearchResults([]);
      setProductSearchStatus("");
      setProductSearchError(error?.message || "ค้นหาสินค้าไม่สำเร็จ");
    } finally {
      setIsSearchingProduct(false);
    }
  }

  function validateForm() {
    const errors = {};
    const qtyNumber = Number(movementForm.qty);
    const selectedUnitOption = productUnitOptions.find(
      (option) => option.id === toCleanText(movementForm.unitLevelId)
    );

    if (!movementForm.movementType) {
      errors.movementType = "กรุณาเลือกประเภทการเคลื่อนไหว";
    }

    if (isFromRequired && !effectiveFromLocationId) {
      errors.fromLocationId = "กรุณาเลือกสถานที่ต้นทาง";
    }

    if (isToRequired && !effectiveToLocationId) {
      errors.toLocationId = "กรุณาเลือกสถานที่ปลายทาง";
    }

    if (
      effectiveFromLocationId &&
      effectiveToLocationId &&
      effectiveFromLocationId === effectiveToLocationId
    ) {
      errors.toLocationId = "สถานที่ต้นทางและปลายทางต้องไม่ซ้ำกัน";
    }

    if (!isLoadingLocations && !locationOptions.length) {
      if (!isFromLocked && isFromRequired) {
        errors.fromLocationId = "ไม่พบรายการสถานที่ กรุณาลองใหม่";
      }
      if (!isToLocked && isToRequired) {
        errors.toLocationId = "ไม่พบรายการสถานที่ กรุณาลองใหม่";
      }
    }

    if (locationOptions.length > 0) {
      if (effectiveFromLocationId && !locationMap.has(effectiveFromLocationId)) {
        errors.fromLocationId = "ไม่พบสถานที่ต้นทางที่เลือก";
      }
      if (effectiveToLocationId && !locationMap.has(effectiveToLocationId)) {
        errors.toLocationId = "ไม่พบสถานที่ปลายทางที่เลือก";
      }
    }

    if (!movementForm.productId) {
      errors.productId = "กรุณาค้นหาและเลือกสินค้า";
    }
    if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) {
      errors.qty = "กรุณาระบุจำนวนที่มากกว่า 0";
    }
    if (isLoadingProductUnits) {
      errors.unit = "กำลังโหลดรายการหน่วย กรุณารอสักครู่";
    } else if (!toCleanText(movementForm.unitLevelId)) {
      errors.unit = "กรุณาเลือกหน่วย";
    } else if (
      movementForm.productId &&
      productUnitOptions.length > 0 &&
      !selectedUnitOption
    ) {
      errors.unit = "หน่วยที่เลือกไม่ตรงกับ product_unit_levels";
    } else if (movementForm.productId && !productUnitOptions.length) {
      errors.unit = "ไม่พบหน่วยของสินค้านี้ใน product_unit_levels";
    }
    if (isTransferOutMovement) {
      if (isLoadingTransferLots) {
        errors.lotNo = "กำลังโหลด lot คงเหลือจากฐานข้อมูล";
      } else if (!effectiveFromLocationId) {
        errors.lotNo = "กรุณาเลือกสถานที่ต้นทางก่อน";
      } else if (!effectiveFromBranchCode) {
        errors.lotNo = "สถานที่ต้นทางต้องเป็นสาขาเพื่อดึง lot อัตโนมัติ";
      } else if (!transferLotOptions.length) {
        errors.lotNo =
          transferLotLoadError || "ไม่พบ lot คงเหลือของสินค้านี้ที่สาขาต้นทาง";
      } else if (!String(movementForm.lotNo || "").trim()) {
        errors.lotNo = "กรุณาเลือก lot จากฐานข้อมูล";
      }

      if (!String(movementForm.expDate || "").trim()) {
        errors.expDate = "ไม่พบวันหมดอายุของ lot ที่เลือก";
      }
    } else {
      if (!String(movementForm.lotNo || "").trim()) {
        errors.lotNo = "กรุณาระบุ lot number";
      }
      if (!String(movementForm.expDate || "").trim()) {
        errors.expDate = "กรุณาระบุวันหมดอายุ (Exp)";
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSaveMovement(event) {
    event.preventDefault();
    setPageError("");

    if (!isAdmin && !branchLocationId) {
      setPageError("ไม่พบ location_id ของผู้ใช้ กรุณาเข้าสู่ระบบใหม่");
      return;
    }
    if (!validateForm()) return;

    setIsSavingMovement(true);
    try {
      const payload = {
        movementType: movementForm.movementType,
        productId: movementForm.productId,
        qty: Number(movementForm.qty),
        unitLevelId: movementForm.unitLevelId,
        unitLabel: movementForm.unit,
        lotNo: String(movementForm.lotNo || "").trim(),
        expDate: normalizeDateOnly(movementForm.expDate),
      };

      if (isAdmin) {
        if (effectiveFromLocationId) {
          payload.from_location_id = effectiveFromLocationId;
        }
        if (effectiveToLocationId) {
          payload.to_location_id = effectiveToLocationId;
        }
      } else if (movementForm.movementType === "RECEIVE") {
        if (toCleanText(movementForm.fromLocationId)) {
          payload.from_location_id = toCleanText(movementForm.fromLocationId);
        }
      } else if (movementForm.movementType === "TRANSFER_OUT") {
        payload.to_location_id = effectiveToLocationId;
      }

      await inventoryApi.createMovement(payload);
      await loadMovements();
      closeMovementModal();
    } catch (error) {
      setPageError(error?.message || "บันทึกรายการไม่สำเร็จ");
    } finally {
      setIsSavingMovement(false);
    }
  }

  function validateOccurredAtCorrectionForm() {
    const errors = {};
    const nextOccurredAt = toCleanText(occurredAtCorrectionForm.correctedOccurredAt);
    const reason = toCleanText(occurredAtCorrectionForm.reason);

    if (!movementCorrectionTarget?.id) {
      errors.form = "ไม่พบรายการที่ต้องการแก้ไข";
    }
    if (!nextOccurredAt) {
      errors.correctedOccurredAt = "กรุณาระบุวันและเวลาใหม่";
    }
    if (!reason) {
      errors.reason = "กรุณาระบุเหตุผลในการแก้ไข";
    }

    setOccurredAtCorrectionErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSaveOccurredAtCorrection(event) {
    event.preventDefault();
    setPageError("");

    if (!isAdmin) {
      setPageError("เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขวันเวลารับเข้าได้");
      return;
    }
    if (!validateOccurredAtCorrectionForm()) return;

    const confirmed = window.confirm(
      "ยืนยันการแก้ไขวันเวลารับเข้าสินค้ารายการนี้? ระบบจะเก็บเหตุผลและผู้แก้ไขไว้ในประวัติ"
    );
    if (!confirmed) {
      return;
    }

    setIsSavingOccurredAtCorrection(true);
    try {
      await inventoryApi.updateMovementOccurredAtCorrection(movementCorrectionTarget.id, {
        correctedOccurredAt: occurredAtCorrectionForm.correctedOccurredAt,
        reason: occurredAtCorrectionForm.reason,
      });
      await loadMovements();
      closeOccurredAtCorrectionModal();
    } catch (error) {
      setPageError(error?.message || "แก้ไขวันเวลารับเข้าไม่สำเร็จ");
    } finally {
      setIsSavingOccurredAtCorrection(false);
    }
  }

  function handleModalBackdropClick(event) {
    if (event.target === event.currentTarget) {
      closeMovementModal();
    }
  }

  function handleOccurredAtCorrectionModalBackdropClick(event) {
    if (event.target === event.currentTarget) {
      closeOccurredAtCorrectionModal();
    }
  }

  return (
    <div className="outerpad receiving-page">
      <div id="product-admin" className="qgrid receiving-top">
        <button
          id="btnReceiveActions"
          className="actionTile"
          type="button"
          aria-label="ลงข้อมูลรับเข้า ส่งออกสินค้า"
          onClick={openMovementModal}
        >
          <div className="logoMark" aria-hidden="true">
            SC
          </div>
          <div className="actionTile-label">ลงข้อมูลรับเข้า ส่งออกสินค้า</div>
        </button>

        <section id="search-panel" className="qcard search-panel">
          <div className="section-header">
            <strong>สืบค้นรายการสินค้า</strong>
          </div>
          <div className="search-row">
            <label htmlFor="prodSearch">ข้อมูลค้นหา</label>
            <input
              id="prodSearch"
              type="text"
              className="qinput"
              placeholder="ชื่อสามัญ / บริษัท / บาร์โค้ด"
            />
            <button type="button" className="btn btn--accent" id="btnSearch">
              🔎 ค้นหา
            </button>
          </div>
        </section>
      </div>

      <div className="qgrid config-grid">
        <div className="qcard config-bar">
          <button id="btnTableConfig" className="btn btn--yellow" type="button">
            ตั้งค่าแสดงผลตาราง
          </button>

          <label className="page-size-label" htmlFor="pageSize">
            <span>แสดง</span>
            <select id="pageSize" className="qinput" defaultValue="50">
              <option value="10">10 รายการ</option>
              <option value="50">50 รายการ</option>
              <option value="100">100 รายการ</option>
              <option value="all">แสดงทั้งหมด</option>
            </select>
            <span>ต่อหน้า</span>
          </label>

          <div id="tableTotals" className="table-totals">
            {totalText}
          </div>
        </div>
      </div>

      {pageError ? <div className="qcard page-error">{pageError}</div> : null}

      <div className="qcard results-card">
        <div className="pos-table">
          <div className="thead">
            {tableColumns.map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>
          <div className="tbody">
            {isLoadingMovements ? (
              <div className="row row--placeholder">
                <div className="center">...</div>
                <div>กำลังโหลดข้อมูลการเคลื่อนไหว</div>
                <div className="center">...</div>
                <div className="center">...</div>
                <div className="center">...</div>
                <div className="right">...</div>
              </div>
            ) : movements.length > 0 ? (
              movements.map((movement, index) => (
                <div
                  key={movement?.id || `${movement?.productCode || "mv"}-${index}`}
                  className="row"
                >
                  <div className="movement-time-cell" title={getOccurredAtTitle(movement)}>
                    <div className="movement-time-text">{movement?.occurredAt || "-"}</div>
                    {movement?.isOccurredAtCorrected ? (
                      <div className="movement-correction-note">แก้เวลาแล้ว</div>
                    ) : null}
                    {isAdmin && movement?.movementType === "RECEIVE" ? (
                      <button
                        type="button"
                        className="movement-inline-action"
                        onClick={() => openOccurredAtCorrectionModal(movement)}
                      >
                        แก้เวลา
                      </button>
                    ) : null}
                  </div>
                  <div className="cell-product-name" title={movement?.productName || "-"}>
                    {movement?.productName || "-"}
                  </div>
                  <div>{movement?.productCode || "-"}</div>
                  <div>{movement?.lotNo || "-"}</div>
                  <div>
                    <span className={`movement-type-badge ${getMovementTypeClass(movement?.movementType)}`}>
                      {MOVEMENT_TYPE_LABEL[movement?.movementType] || movement?.movementType || "-"}
                    </span>
                  </div>
                  <div
                    className={`right movement-delta ${getDeltaClass(movement?.movementType)}`}
                    title={getDeltaTitle(movement)}
                  >
                    {formatDeltaCompact(movement)}
                  </div>
                </div>
              ))
            ) : (
              <div className="row row--placeholder">
                <div className="center">-</div>
                <div>ยังไม่มีข้อมูลรายการเคลื่อนไหว</div>
                <div className="center">-</div>
                <div className="center">-</div>
                <div className="center">-</div>
                <div className="right">-</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isMovementModalOpen ? (
        <div
          className="modal"
          aria-hidden="false"
          role="dialog"
          aria-modal="true"
          aria-labelledby="movement-modal-title"
          onClick={handleModalBackdropClick}
        >
          <div className="qcard modal-card movement-modal-card">
            <div className="section-header">
              <strong id="movement-modal-title">บันทึกรายการเคลื่อนไหวสินค้า</strong>
            </div>
            <form className="movement-form" onSubmit={handleSaveMovement}>
              <div className="field-block">
                <label htmlFor="movementType">ประเภทการเคลื่อนไหว</label>
                <select
                  id="movementType"
                  className="qinput"
                  value={movementForm.movementType ?? ""}
                  onChange={handleMovementTypeChange}
                  required
                >
                  {MOVEMENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {formErrors.movementType ? (
                  <div className="field-error">{formErrors.movementType}</div>
                ) : null}
              </div>

              <div className="field-block">
                <label htmlFor="movementFromLocation">จากสถานที่</label>
                {isFromLocked ? (
                  <div className="location-readonly">{getLocationLabel(effectiveFromLocationId)}</div>
                ) : (
                  <select
                    id="movementFromLocation"
                    className="qinput"
                    value={movementForm.fromLocationId ?? ""}
                    onChange={handleFromLocationChange}
                    disabled={isLoadingLocations || !locationOptions.length}
                    required={isFromRequired}
                  >
                    <option value="">
                      {isFromRequired ? "เลือกสถานที่ต้นทาง" : "ไม่ระบุ (ถ้ามี)"}
                    </option>
                    {locationOptions.map((location) => (
                      <option key={location.id} value={location.id}>
                        {buildLocationLabel(location)}
                      </option>
                    ))}
                  </select>
                )}
                {formErrors.fromLocationId ? (
                  <div className="field-error">{formErrors.fromLocationId}</div>
                ) : null}
              </div>

              {showToLocationField ? (
                <div className="field-block">
                  <label htmlFor="movementToLocation">ไปยัง</label>
                  {isToLocked ? (
                    <div className="location-readonly">{getLocationLabel(effectiveToLocationId)}</div>
                  ) : (
                    <select
                      id="movementToLocation"
                      className="qinput"
                      value={movementForm.toLocationId ?? ""}
                      onChange={(event) => setField("toLocationId", event.target.value)}
                      disabled={isLoadingLocations || !locationOptions.length}
                      required={isToRequired}
                    >
                      <option value="">{isToRequired ? "เลือกสถานที่ปลายทาง" : "ไม่ระบุ"}</option>
                      {locationOptions.map((location) => (
                        <option key={location.id} value={location.id}>
                          {buildLocationLabel(location)}
                        </option>
                      ))}
                    </select>
                  )}
                  {formErrors.toLocationId ? (
                    <div className="field-error">{formErrors.toLocationId}</div>
                  ) : null}
                </div>
              ) : null}

              {isLoadingLocations ? (
                <div className="movement-search-status">กำลังโหลดรายการสถานที่...</div>
              ) : null}
              {locationLoadError ? <div className="field-error">{locationLoadError}</div> : null}

              <div className="field-block">
                <label htmlFor="movementProductSearch">ค้นหาสินค้า</label>
                <div className="movement-search-row">
                  <input
                    id="movementProductSearch"
                    type="text"
                    className="qinput"
                    value={movementForm.productSearch ?? ""}
                    onChange={handleProductSearchInputChange}
                    placeholder="ชื่อสามัญ / บริษัท / บาร์โค้ด"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleProductSearch();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--accent"
                    onClick={handleProductSearch}
                    disabled={isSearchingProduct}
                  >
                    {isSearchingProduct ? "กำลังค้นหา..." : "ค้นหา"}
                  </button>
                </div>
                <div className="product-selected">
                  {movementForm.productId
                    ? `${movementForm.productName} (${movementForm.productCode || "-"})`
                    : "ยังไม่ได้เลือกสินค้า"}
                </div>
                {isSearchingProduct ? (
                  <div className="movement-search-status">กำลังค้นหาสินค้า...</div>
                ) : null}
                {productSearchError ? <div className="field-error">{productSearchError}</div> : null}
                {isLoadingProductUnits ? (
                  <div className="movement-search-status">กำลังโหลดรายการหน่วยจาก product_unit_levels...</div>
                ) : null}
                {productUnitLoadError ? <div className="field-error">{productUnitLoadError}</div> : null}
                {productSearchStatus ? <div className="movement-search-status">{productSearchStatus}</div> : null}
                {productSearchResults.length > 0 ? (
                  <div className="product-search-results" role="region" aria-label="ผลลัพธ์การค้นหาสินค้า">
                    {productSearchResults.map((product) => {
                      const isSelected = movementForm.productId === product.id;
                      return (
                        <button
                          key={product.id}
                          type="button"
                          className={`product-search-result${isSelected ? " is-selected" : ""}`}
                          onClick={() => handleSelectProduct(product)}
                          aria-label={`เลือกสินค้า ${product.tradeName}`}
                        >
                          <span className="product-search-result-name">{product.tradeName}</span>
                          <span className="product-search-result-meta">
                            รหัส: {product.productCode || "-"} | บาร์โค้ด: {product.barcode || "-"} | บริษัท:{" "}
                            {product.manufacturerName || "-"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {formErrors.productId ? <div className="field-error">{formErrors.productId}</div> : null}
              </div>

              <div className="movement-grid">
                <div className="field-block">
                  <label htmlFor="movementQty">จำนวน</label>
                  <input
                    id="movementQty"
                    type="number"
                    min="0"
                    step="0.001"
                    className="qinput"
                    value={movementForm.qty ?? ""}
                    onChange={(event) => setField("qty", event.target.value)}
                    required
                  />
                  {formErrors.qty ? <div className="field-error">{formErrors.qty}</div> : null}
                </div>

                <div className="field-block">
                  <label htmlFor="movementUnit">หน่วย</label>
                  <select
                    id="movementUnit"
                    className="qinput"
                    value={movementForm.unitLevelId ?? ""}
                    onChange={handleUnitChange}
                    disabled={
                      !movementForm.productId || isLoadingProductUnits || productUnitOptions.length === 0
                    }
                    required
                  >
                    <option value="">
                      {!movementForm.productId
                        ? "เลือกสินค้าก่อน"
                        : isLoadingProductUnits
                        ? "กำลังโหลดรายการหน่วย..."
                        : "เลือกหน่วยจาก product_unit_levels"}
                    </option>
                    {productUnitOptions.map((unitOption) => (
                      <option key={unitOption.id} value={unitOption.id}>
                        {unitOption.displayName}
                      </option>
                    ))}
                  </select>
                  {formErrors.unit ? <div className="field-error">{formErrors.unit}</div> : null}
                </div>
              </div>

              <div className="movement-grid">
                <div className="field-block">
                  <label htmlFor={isTransferOutMovement ? "movementLotSelect" : "movementLotNo"}>
                    Lot Number
                  </label>
                  {isTransferOutMovement ? (
                    <>
                      <select
                        id="movementLotSelect"
                        className="qinput"
                        value={selectedTransferLotValue}
                        onChange={handleTransferLotChange}
                        disabled={
                          !movementForm.productId ||
                          !effectiveFromLocationId ||
                          !effectiveFromBranchCode ||
                          isLoadingTransferLots ||
                          transferLotOptions.length === 0
                        }
                        required
                      >
                        <option value="">
                          {!movementForm.productId
                            ? "เลือกสินค้าก่อน"
                            : !effectiveFromLocationId
                            ? "เลือกสถานที่ต้นทางก่อน"
                            : !effectiveFromBranchCode
                            ? "สถานที่ต้นทางต้องเป็นสาขา"
                            : isLoadingTransferLots
                            ? "กำลังโหลด lot จากฐานข้อมูล..."
                            : "ไม่พบ lot คงเหลือ"}
                        </option>
                        {transferLotOptions.map((option) => (
                          <option
                            key={option.lotId || getLotOptionValue(option.lotNo, option.expDate)}
                            value={getLotOptionValue(option.lotNo, option.expDate)}
                          >
                            {buildTransferLotOptionLabel(option)}
                          </option>
                        ))}
                      </select>
                      <div className="movement-search-status">
                        ระบบดึง lot คงเหลือจากฐานข้อมูลของสาขาต้นทางให้อัตโนมัติ
                      </div>
                      {transferLotLoadError ? (
                        <div className="field-error">{transferLotLoadError}</div>
                      ) : null}
                    </>
                  ) : (
                    <input
                      id="movementLotNo"
                      type="text"
                      className="qinput"
                      value={movementForm.lotNo ?? ""}
                      onChange={(event) => setField("lotNo", event.target.value)}
                      placeholder="เช่น LOT2402A"
                      required
                    />
                  )}
                  {formErrors.lotNo ? <div className="field-error">{formErrors.lotNo}</div> : null}
                </div>

                <div className="field-block">
                  <label htmlFor="movementExpDate">วันหมดอายุ (Exp)</label>
                  {isTransferOutMovement ? (
                    <>
                      <input
                        id="movementExpDate"
                        type="date"
                        className="qinput"
                        value={movementForm.expDate ?? ""}
                        readOnly
                        disabled
                      />
                      <div className="movement-search-status">เติมอัตโนมัติตาม lot ที่เลือก</div>
                    </>
                  ) : (
                    <input
                      id="movementExpDate"
                      type="date"
                      className="qinput"
                      value={movementForm.expDate ?? ""}
                      onChange={(event) => setField("expDate", event.target.value)}
                      required
                    />
                  )}
                  {formErrors.expDate ? <div className="field-error">{formErrors.expDate}</div> : null}
                </div>
              </div>

              <div className="field-block">
                <label>วันเวลาเกิดรายการ</label>
                <div className="location-readonly">ระบบจะใช้เวลาปัจจุบันอัตโนมัติ ณ ตอนกดบันทึก</div>
              </div>

              <div className="modal-actions">
                <button className="btn" type="button" onClick={closeMovementModal} disabled={isSavingMovement}>
                  ยกเลิก
                </button>
                <button className="btn btn--yellow" type="submit" disabled={isSavingMovement}>
                  {isSavingMovement ? "กำลังบันทึก..." : "บันทึก"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isOccurredAtCorrectionModalOpen ? (
        <div
          className="modal"
          aria-hidden="false"
          role="dialog"
          aria-modal="true"
          aria-labelledby="movement-occurred-at-correction-modal-title"
          onClick={handleOccurredAtCorrectionModalBackdropClick}
        >
          <div className="qcard modal-card movement-modal-card">
            <div className="section-header">
              <strong id="movement-occurred-at-correction-modal-title">
                แก้ไขวันเวลารับเข้าสินค้า
              </strong>
            </div>
            <form className="movement-form" onSubmit={handleSaveOccurredAtCorrection}>
              <div className="correction-summary">
                <div>
                  <strong>สินค้า:</strong>{" "}
                  {movementCorrectionTarget?.productName || "-"} (
                  {movementCorrectionTarget?.productCode || "-"})
                </div>
                <div>
                  <strong>Lot:</strong> {movementCorrectionTarget?.lotNo || "-"}
                </div>
                <div>
                  <strong>เวลาที่แสดงตอนนี้:</strong> {movementCorrectionTarget?.occurredAt || "-"}
                </div>
                <div>
                  <strong>เวลาต้นฉบับ:</strong>{" "}
                  {movementCorrectionTarget?.originalOccurredAt || "-"}
                </div>
                {movementCorrectionTarget?.isOccurredAtCorrected ? (
                  <div className="movement-search-status">
                    correction ล่าสุดโดย {getOccurredAtCorrectionActorLabel(movementCorrectionTarget)} เมื่อ{" "}
                    {movementCorrectionTarget?.occurredAtCorrectedAt || "-"}:{" "}
                    {movementCorrectionTarget?.occurredAtCorrectionReason || "-"}
                  </div>
                ) : (
                  <div className="movement-search-status">
                    ถ้าเลือกเวลาเท่ากับค่าต้นฉบับ ระบบจะกลับไปใช้ `occurred_at` เดิมโดยไม่กระทบ stock
                  </div>
                )}
              </div>

              {occurredAtCorrectionErrors.form ? (
                <div className="field-error">{occurredAtCorrectionErrors.form}</div>
              ) : null}

              <div className="field-block">
                <label htmlFor="movementOccurredAtCorrection">วันเวลาใหม่ที่ต้องการแสดง</label>
                <input
                  id="movementOccurredAtCorrection"
                  type="datetime-local"
                  className="qinput"
                  value={occurredAtCorrectionForm.correctedOccurredAt ?? ""}
                  onChange={(event) =>
                    setOccurredAtCorrectionField("correctedOccurredAt", event.target.value)
                  }
                  required
                />
                {occurredAtCorrectionErrors.correctedOccurredAt ? (
                  <div className="field-error">
                    {occurredAtCorrectionErrors.correctedOccurredAt}
                  </div>
                ) : null}
              </div>

              <div className="field-block">
                <label htmlFor="movementOccurredAtCorrectionReason">เหตุผลในการแก้ไข</label>
                <textarea
                  id="movementOccurredAtCorrectionReason"
                  className="qinput correction-reason-input"
                  value={occurredAtCorrectionForm.reason ?? ""}
                  onChange={(event) => setOccurredAtCorrectionField("reason", event.target.value)}
                  placeholder="ระบุเหตุผล เช่น พนักงานกรอกเวลาผิดจากใบรับสินค้า"
                  rows={4}
                  required
                />
                {occurredAtCorrectionErrors.reason ? (
                  <div className="field-error">{occurredAtCorrectionErrors.reason}</div>
                ) : null}
              </div>

              <div className="modal-actions">
                <button
                  className="btn"
                  type="button"
                  onClick={closeOccurredAtCorrectionModal}
                  disabled={isSavingOccurredAtCorrection}
                >
                  ยกเลิก
                </button>
                <button
                  className="btn btn--yellow"
                  type="submit"
                  disabled={isSavingOccurredAtCorrection}
                >
                  {isSavingOccurredAtCorrection ? "กำลังบันทึก..." : "ยืนยันการแก้เวลา"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div id="tablePager" className="qcard table-pager"></div>

      <div id="tableConfigModal" className="modal hidden" aria-hidden="true">
        <div className="qcard modal-card">
          <div className="section-header">
            <strong>ตั้งค่าแสดงผลตาราง</strong>
          </div>
          <ul id="colList" className="col-list"></ul>
          <div className="modal-actions">
            <button className="btn" id="btnCfgCancel" type="button">
              ยกเลิก
            </button>
            <button className="btn btn--yellow" id="btnCfgSave" type="button">
              บันทึก
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
