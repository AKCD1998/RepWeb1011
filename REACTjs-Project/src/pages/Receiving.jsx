import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { INVENTORY_CHANGED_EVENT, inventoryApi, productsApi } from "../lib/api";
import {
  formatDisplayNumber as formatQty,
  formatQuantityAsUnits,
  formatStructuredUnitLabel,
  normalizeInlineText,
  unitTypeRequiresWholeQuantity,
} from "../lib/productUnits";
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
      const unitLabel = toCleanText(row?.unitLabel || row?.unit_label);
      const baseUnitLabel = toCleanText(row?.baseUnitLabel || row?.base_unit_label || unitLabel);

      return {
        lotId,
        lotNo,
        expDate,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        unitLabel,
        baseUnitLabel,
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
  const stockUnitLabel = toCleanText(option?.baseUnitLabel || option?.unitLabel);
  const qtyText = Number.isFinite(Number(option?.quantity))
    ? ` • คงเหลือ ${formatQuantityWithUnit(option.quantity, stockUnitLabel)}`
    : "";
  return `${lotNo} (exp ${expDate}${qtyText})`;
}

function formatQuantityWithUnit(quantity, unitLabel) {
  const qtyNumber = Number(quantity);
  if (!Number.isFinite(qtyNumber)) return "-";

  const formatted = formatQuantityAsUnits(qtyNumber, unitLabel);
  if (formatted && formatted !== "-") {
    return formatted;
  }

  return `${formatQty(qtyNumber)}${unitLabel ? ` ${unitLabel}` : ""}`.trim();
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
  };
}

function createMovementLine(overrides = {}) {
  return {
    id: `movement-line-${Math.random().toString(36).slice(2, 10)}`,
    lotId: "",
    lotNo: "",
    expDate: "",
    qty: "",
    unitLevelId: "",
    unitLabel: "",
    availableQuantityBase: null,
    ...overrides,
  };
}

function getMovementLineLotKey(line) {
  const lotId = toCleanText(line?.lotId);
  if (lotId) return lotId;
  return getLotOptionValue(line?.lotNo, line?.expDate);
}

function formatDateOnlyDisplay(value) {
  const text = normalizeDateOnly(value);
  if (!text) return "-";
  const [year, month, day] = text.split("-");
  if (!year || !month || !day) return text;
  return `${day}/${month}/${year}`;
}

function normalizeUnitOptionsResponse(response) {
  const rows = Array.isArray(response?.items)
    ? response.items
    : Array.isArray(response)
    ? response
    : [];

  return rows
    .map((row) => ({
      id: toCleanText(row?.id),
      displayName: toCleanText(row?.displayName || row?.display_name || row?.code),
      isSellable: Boolean(row?.isSellable ?? row?.is_sellable),
      sortOrder: Number(row?.sortOrder ?? row?.sort_order ?? 0),
      quantityPerBase: Number(row?.quantityPerBase ?? row?.quantity_per_base),
      unitTypeCode: toCleanText(row?.unitTypeCode || row?.unit_type_code),
      requiresWholeQuantity: unitTypeRequiresWholeQuantity(row?.unitTypeCode || row?.unit_type_code),
    }))
    .filter((row) => row.id && row.displayName)
    .sort((a, b) => {
      const aQpb = Number.isFinite(a.quantityPerBase) ? a.quantityPerBase : Number.POSITIVE_INFINITY;
      const bQpb = Number.isFinite(b.quantityPerBase) ? b.quantityPerBase : Number.POSITIVE_INFINITY;
      if (aQpb !== bQpb) return aQpb - bQpb;
      return a.sortOrder - b.sortOrder;
    });
}

function parseRequestedQuantityBase(line, unitOption) {
  const qtyNumber = Number(line?.qty);
  const quantityPerBase = Number(unitOption?.quantityPerBase);
  if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) return null;
  if (!Number.isFinite(quantityPerBase) || quantityPerBase <= 0) return null;
  return qtyNumber * quantityPerBase;
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

function getPrimaryMovementUnitLabel(movement) {
  const movementUnit = normalizeInlineText(movement?.movementUnit);
  if (movementUnit) return movementUnit;
  return normalizeInlineText(movement?.unit);
}

function getDeltaText(movement) {
  const sign = isPositiveMovement(movement?.movementType) ? "+" : "-";
  const qtyValue = Number(movement?.qtyValue);
  const qtyMagnitude = Number.isFinite(qtyValue) ? Math.abs(qtyValue) : movement?.qtyValue;
  const qtyText = formatQty(qtyMagnitude);
  const primaryUnitLabel = getPrimaryMovementUnitLabel(movement);
  const primaryTextValue = formatQuantityAsUnits(qtyMagnitude, primaryUnitLabel);
  const primaryText = primaryTextValue === "-" ? "-" : `${sign}${primaryTextValue}`;

  const quantityBaseValue = Number(movement?.qtyBaseValue);
  if (!Number.isFinite(quantityBaseValue)) return primaryText;

  const baseQtyText = formatQty(Math.abs(quantityBaseValue));
  const baseUnitLabel = normalizeInlineText(movement?.baseUnitLabel);
  const primaryUnitText = formatStructuredUnitLabel(primaryUnitLabel);
  const shouldShowBase =
    baseQtyText !== qtyText ||
    (baseUnitLabel && !primaryUnitText.toLowerCase().includes(baseUnitLabel.toLowerCase()));

  if (!shouldShowBase) return primaryText;
  return `${primaryText} (${sign}${baseQtyText}${baseUnitLabel ? ` ${baseUnitLabel}` : ""} ฐาน)`;
}

function formatDeltaCompact(movement) {
  const sign = isPositiveMovement(movement?.movementType) ? "+" : "-";
  const qtyValue = Number(movement?.qtyValue);
  const qtyMagnitude = Number.isFinite(qtyValue) ? Math.abs(qtyValue) : movement?.qtyValue;
  const qtyText = formatQty(qtyMagnitude);
  const primaryUnitLabel = getPrimaryMovementUnitLabel(movement);
  const primaryUnitText = formatStructuredUnitLabel(primaryUnitLabel);
  const quantityText = formatQuantityAsUnits(qtyMagnitude, primaryUnitLabel);
  let compactText = quantityText === "-" ? "-" : `${sign}${quantityText}`;

  const quantityBaseValue = Number(movement?.qtyBaseValue);
  if (!Number.isFinite(quantityBaseValue)) return compactText;

  const baseQtyText = formatQty(Math.abs(quantityBaseValue));
  const baseUnitLabel = normalizeInlineText(movement?.baseUnitLabel);
  const shouldShowBase =
    baseQtyText !== qtyText ||
    (baseUnitLabel && !primaryUnitText.toLowerCase().includes(baseUnitLabel.toLowerCase()));

  if (!shouldShowBase) return compactText;

  const signedBaseQty = `${sign}${baseQtyText}`;
  const shouldShowBaseUnit =
    baseUnitLabel && !primaryUnitText.toLowerCase().includes(baseUnitLabel.toLowerCase());
  return `${compactText} • ฐาน ${signedBaseQty}${shouldShowBaseUnit ? ` ${baseUnitLabel}` : ""}`;
}

function getDeltaTitle(movement) {
  const fullDeltaText = getDeltaText(movement);
  const movementUnit = normalizeInlineText(movement?.movementUnit);
  const unit = normalizeInlineText(movement?.unit);

  if (!movementUnit || movementUnit.toLowerCase() === unit.toLowerCase()) {
    return fullDeltaText;
  }

  return `${fullDeltaText}\nหน่วยขายหลัก: ${formatStructuredUnitLabel(unit)}`;
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
  const viewerLocationId = branchLocationId || "";

  const [movements, setMovements] = useState([]);
  const [locations, setLocations] = useState([]);
  const [isLoadingMovements, setIsLoadingMovements] = useState(false);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [isMovementConfirmModalOpen, setIsMovementConfirmModalOpen] = useState(false);
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
  const [movementLines, setMovementLines] = useState(() => [createMovementLine()]);
  const [movementCorrectionTarget, setMovementCorrectionTarget] = useState(null);
  const [occurredAtCorrectionForm, setOccurredAtCorrectionForm] = useState(() =>
    createInitialOccurredAtCorrectionForm(null)
  );
  const [occurredAtCorrectionErrors, setOccurredAtCorrectionErrors] = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [lineErrors, setLineErrors] = useState({});
  const [pageError, setPageError] = useState("");
  const [productSearchStatus, setProductSearchStatus] = useState("");
  const [lineUnitOptionsById, setLineUnitOptionsById] = useState({});
  const [lineUnitLoadingById, setLineUnitLoadingById] = useState({});
  const [lineUnitLoadErrorById, setLineUnitLoadErrorById] = useState({});
  const [transferLotOptions, setTransferLotOptions] = useState([]);
  const [isLoadingTransferLots, setIsLoadingTransferLots] = useState(false);
  const [transferLotLoadError, setTransferLotLoadError] = useState("");
  const lineUnitRequestSeqRef = useRef({});
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
  const fromLocationOptions = useMemo(() => {
    if (isAdmin) {
      return locationOptions;
    }

    return locationOptions.filter((location) => {
      const locationType = normalizeRole(location?.type || location?.location_type);
      return locationType === "BRANCH" || locationType === "OFFICE";
    });
  }, [isAdmin, locationOptions]);

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
  const isDispenseMovement = movementForm.movementType === "DISPENSE";
  const fromLocation = locationMap.get(effectiveFromLocationId) || null;
  const fromLocationType = normalizeRole(fromLocation?.type);
  const effectiveFromBranchCode =
    fromLocationType === "BRANCH"
      ? toCleanText(fromLocation?.code)
      : effectiveFromLocationId && effectiveFromLocationId === branchLocationId
      ? userBranchCode
      : "";
  const transferLotOptionsByKey = useMemo(() => {
    return new Map(
      transferLotOptions.map((option) => [option.lotId || getLotOptionValue(option.lotNo, option.expDate), option])
    );
  }, [transferLotOptions]);
  const selectedTransferLotKeys = useMemo(() => {
    return new Set(
      movementLines
        .map((line) => getMovementLineLotKey(line))
        .filter(Boolean)
    );
  }, [movementLines]);
  const hasAnyLineUnitLoading = useMemo(() => {
    return Object.values(lineUnitLoadingById).some(Boolean);
  }, [lineUnitLoadingById]);
  const movementLineViewModels = useMemo(() => {
    return movementLines.map((line, index) => {
      const unitOptions = Array.isArray(lineUnitOptionsById[line.id]) ? lineUnitOptionsById[line.id] : [];
      const selectedUnitOption =
        unitOptions.find((option) => option.id === toCleanText(line?.unitLevelId)) || null;
      const lotKey = getMovementLineLotKey(line);
      const stockOption = lotKey ? transferLotOptionsByKey.get(lotKey) || null : null;
      const availableQuantityBase = Number(stockOption?.quantity ?? line?.availableQuantityBase);

      return {
        line,
        index,
        lineErrors: lineErrors[line.id] || {},
        unitOptions,
        selectedUnitOption,
        isUnitLoading: Boolean(lineUnitLoadingById[line.id]),
        unitLoadError: toCleanText(lineUnitLoadErrorById[line.id]),
        qtyStep: selectedUnitOption?.requiresWholeQuantity ? "1" : "0.001",
        stockOption,
        availableQuantityBase: Number.isFinite(availableQuantityBase) ? availableQuantityBase : null,
        availableUnitLabel: toCleanText(stockOption?.baseUnitLabel || stockOption?.unitLabel),
      };
    });
  }, [
    lineErrors,
    lineUnitLoadErrorById,
    lineUnitLoadingById,
    lineUnitOptionsById,
    movementLines,
    transferLotOptionsByKey,
  ]);
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
  const movementDirectionSummary = useMemo(() => {
    if (movementForm.movementType === "DISPENSE") {
      return `จาก ${getLocationLabel(effectiveFromLocationId)}`;
    }

    return `จาก ${getLocationLabel(effectiveFromLocationId)} ไปยัง ${getLocationLabel(
      effectiveToLocationId
    )}`;
  }, [effectiveFromLocationId, effectiveToLocationId, getLocationLabel, movementForm.movementType]);

  const loadMovements = useCallback(async () => {
    if (!isAdmin && !viewerLocationId) {
      setMovements([]);
      return;
    }

    setIsLoadingMovements(true);
    try {
      const rows = await inventoryApi.listMovements({
        location_id: viewerLocationId || undefined,
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
  }, [isAdmin, viewerLocationId]);

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

  function resetLineUnitState() {
    lineUnitRequestSeqRef.current = {};
    setLineUnitOptionsById({});
    setLineUnitLoadingById({});
    setLineUnitLoadErrorById({});
  }

  function clearMovementLinesState(nextLines = [createMovementLine()]) {
    resetLineUnitState();
    setMovementLines(nextLines);
    setLineErrors({});
  }

  function closeMovementConfirmModal() {
    setIsMovementConfirmModalOpen(false);
  }

  useEffect(() => {
    if (!isMovementModalOpen && !isMovementConfirmModalOpen && !isOccurredAtCorrectionModalOpen) {
      return undefined;
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        if (isMovementConfirmModalOpen) {
          closeMovementConfirmModal();
          return;
        }
        if (isOccurredAtCorrectionModalOpen) {
          closeOccurredAtCorrectionModal();
          return;
        }
        closeMovementModal();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isMovementConfirmModalOpen, isMovementModalOpen, isOccurredAtCorrectionModalOpen]);

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
    setLineErrors({});
    setProductSearchResults([]);
    setProductSearchError("");
    setProductSearchStatus("");
    clearMovementLinesState([createMovementLine()]);
    resetTransferLotLookup();
    setIsMovementModalOpen(true);
  }

  function closeMovementModal() {
    closeMovementConfirmModal();
    clearMovementLinesState([createMovementLine()]);
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
    const productId = toCleanText(movementForm.productId);
    if (!isMovementModalOpen || !isTransferOutMovement) {
      resetTransferLotLookup();
      return;
    }

    if (!productId) {
      resetTransferLotLookup();
      clearMovementLinesState([]);
      return;
    }

    if (!effectiveFromLocationId) {
      resetTransferLotLookup();
      clearMovementLinesState([]);
      return;
    }

    if (!effectiveFromBranchCode) {
      resetTransferLotLookup();
      clearMovementLinesState([]);
      setTransferLotLoadError("สถานที่ต้นทางต้องเป็นสาขาเพื่อดึง lot คงเหลือ");
      return;
    }

    transferLotRequestSeqRef.current += 1;
    const requestSeq = transferLotRequestSeqRef.current;

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
        const nextOptionKeySet = new Set(
          nextOptions.map((option) => option.lotId || getLotOptionValue(option.lotNo, option.expDate))
        );

        setTransferLotOptions(nextOptions);
        setTransferLotLoadError(
          nextOptions.length ? "" : "ไม่พบ lot คงเหลือของสินค้านี้ที่สาขาต้นทาง"
        );
        setMovementLines((prev) =>
          prev
            .filter((line) => !line.lotId || nextOptionKeySet.has(getMovementLineLotKey(line)))
            .map((line) => {
              const option = nextOptions.find(
                (item) =>
                  (item.lotId || getLotOptionValue(item.lotNo, item.expDate)) ===
                  getMovementLineLotKey(line)
              );
              if (!option) return line;
              return {
                ...line,
                lotId: toCleanText(option.lotId),
                lotNo: toCleanText(option.lotNo),
                expDate: normalizeDateOnly(option.expDate),
                availableQuantityBase: Number(option.quantity),
              };
            })
        );
      })
      .catch((error) => {
        if (requestSeq !== transferLotRequestSeqRef.current) return;
        setTransferLotOptions([]);
        setTransferLotLoadError(error?.message || "โหลดรายการ lot จากฐานข้อมูลไม่สำเร็จ");
        clearMovementLinesState([]);
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
      lines: "",
    }));
  }

  function removeLineUnitState(lineId) {
    lineUnitRequestSeqRef.current = {
      ...lineUnitRequestSeqRef.current,
      [lineId]: (lineUnitRequestSeqRef.current[lineId] || 0) + 1,
    };
    setLineUnitOptionsById((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setLineUnitLoadingById((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setLineUnitLoadErrorById((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setLineErrors((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  }

  const loadLineUnitOptions = useCallback(async (line, optionsInput = {}) => {
    const normalizedLineId = toCleanText(line?.id);
    const normalizedProductId = toCleanText(optionsInput.productId ?? movementForm.productId);
    const normalizedPreferredUnitLevelId = toCleanText(
      optionsInput.preferredUnitLevelId ?? line?.unitLevelId
    );
    const normalizedPreferredUnitLabel = toCleanText(
      optionsInput.preferredUnitLabel ?? line?.unitLabel
    );
    const normalizedLotId = toCleanText(optionsInput.lotId ?? line?.lotId);
    const normalizedLotNo = toCleanText(optionsInput.lotNo ?? line?.lotNo);
    const normalizedExpDate = normalizeDateOnly(optionsInput.expDate ?? line?.expDate);
    const hasLotContext = Boolean(normalizedLotId || (normalizedLotNo && normalizedExpDate));
    const requestSeq = (lineUnitRequestSeqRef.current[normalizedLineId] || 0) + 1;

    lineUnitRequestSeqRef.current = {
      ...lineUnitRequestSeqRef.current,
      [normalizedLineId]: requestSeq,
    };

    if (!normalizedLineId) return;

    if (!normalizedProductId) {
      removeLineUnitState(normalizedLineId);
      setMovementLines((prev) =>
        prev.map((row) =>
          row.id === normalizedLineId ? { ...row, unitLevelId: "", unitLabel: "" } : row
        )
      );
      return;
    }

    setLineUnitLoadingById((prev) => ({
      ...prev,
      [normalizedLineId]: true,
    }));
    setLineUnitLoadErrorById((prev) => ({
      ...prev,
      [normalizedLineId]: "",
    }));

    try {
      const response = await productsApi.unitLevels(normalizedProductId, {
        lotId: normalizedLotId || undefined,
        lotNo: hasLotContext && !normalizedLotId ? normalizedLotNo : undefined,
        expDate: hasLotContext && !normalizedLotId ? normalizedExpDate : undefined,
      });
      if (lineUnitRequestSeqRef.current[normalizedLineId] !== requestSeq) return;

      const options = normalizeUnitOptionsResponse(response);
      const defaultUnitLevelId = toCleanText(
        response?.defaultUnitLevelId || response?.default_unit_level_id
      );
      const preferLotDefault = String(response?.scope || "").trim() === "lot-whitelist";

      setLineUnitOptionsById((prev) => ({
        ...prev,
        [normalizedLineId]: options,
      }));

      if (!options.length) {
        const loadErrorMessage =
          String(response?.scope || "").trim() === "lot-whitelist" &&
          String(response?.fallbackReason || "").trim() ===
            "lot_whitelist_has_no_active_unit_levels"
            ? "lot นี้มี packaging whitelist แต่ไม่พบหน่วยที่ยังใช้งานได้"
            : "ไม่พบหน่วยของสินค้านี้ใน product_unit_levels";

        setMovementLines((prev) =>
          prev.map((row) =>
            row.id === normalizedLineId ? { ...row, unitLevelId: "", unitLabel: "" } : row
          )
        );
        setLineUnitLoadErrorById((prev) => ({
          ...prev,
          [normalizedLineId]: loadErrorMessage,
        }));
        return;
      }

      const nextUnitOption = preferLotDefault
        ? options.find((option) => option.id === defaultUnitLevelId) ||
          options.find((option) => option.id === normalizedPreferredUnitLevelId) ||
          options.find((option) => option.displayName === normalizedPreferredUnitLabel) ||
          options[0]
        : options.find((option) => option.id === normalizedPreferredUnitLevelId) ||
          options.find((option) => option.displayName === normalizedPreferredUnitLabel) ||
          options.find((option) => option.id === defaultUnitLevelId) ||
          options[0];

      setMovementLines((prev) =>
        prev.map((row) =>
          row.id === normalizedLineId
            ? {
                ...row,
                unitLevelId: nextUnitOption.id,
                unitLabel: nextUnitOption.displayName,
              }
            : row
        )
      );
      setLineErrors((prev) => ({
        ...prev,
        [normalizedLineId]: {
          ...(prev[normalizedLineId] || {}),
          unit: "",
        },
      }));
    } catch (error) {
      if (lineUnitRequestSeqRef.current[normalizedLineId] !== requestSeq) return;
      const loadErrorMessage = error?.message || "โหลดรายการหน่วยไม่สำเร็จ";
      setLineUnitOptionsById((prev) => ({
        ...prev,
        [normalizedLineId]: [],
      }));
      setMovementLines((prev) =>
        prev.map((row) =>
          row.id === normalizedLineId ? { ...row, unitLevelId: "", unitLabel: "" } : row
        )
      );
      setLineUnitLoadErrorById((prev) => ({
        ...prev,
        [normalizedLineId]: loadErrorMessage,
      }));
    } finally {
      if (lineUnitRequestSeqRef.current[normalizedLineId] === requestSeq) {
        setLineUnitLoadingById((prev) => ({
          ...prev,
          [normalizedLineId]: false,
        }));
      }
    }
  }, [movementForm.productId]);

  function handleFromLocationChange(event) {
    const nextFromLocationId = event.target.value;
    if (!isTransferOutMovement) {
      setField("fromLocationId", nextFromLocationId);
      return;
    }

    resetTransferLotLookup();
    clearMovementLinesState([]);
    setMovementForm((prev) => ({
      ...prev,
      fromLocationId: nextFromLocationId,
    }));
    setFormErrors((prev) => ({
      ...prev,
      fromLocationId: "",
      lines: "",
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

  function handleProductSearchInputChange(event) {
    const keyword = event.target.value;
    resetTransferLotLookup();
    const nextLines = isTransferOutMovement ? [] : [createMovementLine()];
    setMovementForm((prev) => ({
      ...prev,
      productSearch: keyword,
      productId: "",
      productName: "",
      productCode: "",
    }));
    clearMovementLinesState(nextLines);
    setProductSearchResults([]);
    setProductSearchError("");
    setProductSearchStatus("");
    setFormErrors((prev) => ({
      ...prev,
      productId: "",
      lines: "",
    }));
  }

  function handleSelectProduct(product) {
    resetTransferLotLookup();
    const nextLines = isTransferOutMovement ? [] : [createMovementLine()];
    setMovementForm((prev) => ({
      ...prev,
      productId: product.id,
      productName: product.tradeName,
      productCode: product.productCode,
    }));
    clearMovementLinesState(nextLines);
    setProductSearchError("");
    setProductSearchStatus(`เลือกสินค้าแล้ว: ${product.tradeName}`);
    setFormErrors((prev) => ({
      ...prev,
      productId: "",
      lines: "",
    }));

    if (!isTransferOutMovement) {
      void loadLineUnitOptions(nextLines[0], {
        productId: product.id,
      });
    }
  }

  function handleMovementTypeChange(event) {
    const nextType = event.target.value;
    resetTransferLotLookup();
    const nextLines = nextType === "TRANSFER_OUT" ? [] : [createMovementLine()];
    const currentProductId = toCleanText(movementForm.productId);
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
      };
    });
    clearMovementLinesState(nextLines);
    setFormErrors((prev) => ({
      ...prev,
      movementType: "",
      fromLocationId: "",
      toLocationId: "",
      lines: "",
    }));

    if (currentProductId && nextType !== "TRANSFER_OUT") {
      void loadLineUnitOptions(nextLines[0], {
        productId: currentProductId,
      });
    }
  }

  function updateMovementLine(lineId, buildNextLine) {
    const currentLine = movementLines.find((line) => line.id === lineId);
    if (!currentLine) return null;
    const nextLine =
      typeof buildNextLine === "function"
        ? buildNextLine(currentLine)
        : { ...currentLine, ...(buildNextLine || {}) };

    setMovementLines((prev) => prev.map((line) => (line.id === lineId ? nextLine : line)));
    setLineErrors((prev) => ({
      ...prev,
      [lineId]: {
        ...(prev[lineId] || {}),
      },
    }));
    return nextLine;
  }

  function getLineUnitOptions(lineId) {
    return Array.isArray(lineUnitOptionsById[lineId]) ? lineUnitOptionsById[lineId] : [];
  }

  function getSelectedUnitOptionForLine(line) {
    return getLineUnitOptions(line?.id).find((option) => option.id === toCleanText(line?.unitLevelId)) || null;
  }

  function getLineQtyStep(line) {
    const selectedOption = getSelectedUnitOptionForLine(line);
    return selectedOption?.requiresWholeQuantity ? "1" : "0.001";
  }

  function handleLineFieldChange(lineId, field, value) {
    const nextLine = updateMovementLine(lineId, {
      [field]: value,
    });
    if (!nextLine) return;

    setLineErrors((prev) => ({
      ...prev,
      [lineId]: {
        ...(prev[lineId] || {}),
        [field]: "",
        unit: field === "lotNo" || field === "expDate" ? "" : prev[lineId]?.unit || "",
      },
    }));

    if ((field === "lotNo" || field === "expDate") && !isTransferOutMovement && movementForm.productId) {
      const nextLotNo = field === "lotNo" ? value : nextLine.lotNo;
      const nextExpDate = field === "expDate" ? value : nextLine.expDate;
      const hasLotContext = Boolean(toCleanText(nextLotNo) && normalizeDateOnly(nextExpDate));

      void loadLineUnitOptions(
        {
          ...nextLine,
          lotNo: nextLotNo,
          expDate: nextExpDate,
        },
        {
          productId: movementForm.productId,
          lotNo: hasLotContext ? nextLotNo : "",
          expDate: hasLotContext ? nextExpDate : "",
        }
      );
    }
  }

  function handleLineUnitChange(lineId, nextUnitLevelId) {
    const selectedOption = getLineUnitOptions(lineId).find(
      (option) => option.id === toCleanText(nextUnitLevelId)
    );

    updateMovementLine(lineId, {
      unitLevelId: toCleanText(nextUnitLevelId),
      unitLabel: selectedOption?.displayName || "",
    });
    setLineErrors((prev) => ({
      ...prev,
      [lineId]: {
        ...(prev[lineId] || {}),
        unit: "",
      },
    }));
  }

  function handleAddManualLine() {
    const nextLine = createMovementLine();
    setMovementLines((prev) => [...prev, nextLine]);
    if (movementForm.productId) {
      void loadLineUnitOptions(nextLine, {
        productId: movementForm.productId,
      });
    }
  }

  function handleDuplicateLine(lineId) {
    const sourceLine = movementLines.find((line) => line.id === lineId);
    if (!sourceLine) return;

    const nextLine = createMovementLine({
      lotId: sourceLine.lotId,
      lotNo: sourceLine.lotNo,
      expDate: sourceLine.expDate,
      qty: "",
      unitLevelId: sourceLine.unitLevelId,
      unitLabel: sourceLine.unitLabel,
      availableQuantityBase: sourceLine.availableQuantityBase,
    });

    setMovementLines((prev) => [...prev, nextLine]);
    if (Array.isArray(lineUnitOptionsById[lineId]) && lineUnitOptionsById[lineId].length) {
      setLineUnitOptionsById((prev) => ({
        ...prev,
        [nextLine.id]: prev[lineId],
      }));
    } else if (movementForm.productId) {
      void loadLineUnitOptions(nextLine, {
        productId: movementForm.productId,
        lotId: nextLine.lotId,
        lotNo: nextLine.lotNo,
        expDate: nextLine.expDate,
        preferredUnitLevelId: nextLine.unitLevelId,
        preferredUnitLabel: nextLine.unitLabel,
      });
    }
  }

  function handleRemoveLine(lineId) {
    const nextLines = movementLines.filter((line) => line.id !== lineId);
    if (!nextLines.length && !isTransferOutMovement) {
      const fallbackLine = createMovementLine();
      setMovementLines([fallbackLine]);
      if (movementForm.productId) {
        void loadLineUnitOptions(fallbackLine, {
          productId: movementForm.productId,
        });
      }
    } else {
      setMovementLines(nextLines);
    }
    removeLineUnitState(lineId);
  }

  function handleTransferLotToggle(option, checked) {
    const lotKey = option?.lotId || getLotOptionValue(option?.lotNo, option?.expDate);
    if (!lotKey) return;

    if (!checked) {
      const removedIds = movementLines
        .filter((line) => getMovementLineLotKey(line) === lotKey)
        .map((line) => line.id);
      setMovementLines((prev) => prev.filter((line) => getMovementLineLotKey(line) !== lotKey));
      removedIds.forEach((lineId) => removeLineUnitState(lineId));
      return;
    }

    if (movementLines.some((line) => getMovementLineLotKey(line) === lotKey)) {
      return;
    }

    const nextLine = createMovementLine({
      lotId: toCleanText(option?.lotId),
      lotNo: toCleanText(option?.lotNo),
      expDate: normalizeDateOnly(option?.expDate),
      availableQuantityBase: Number(option?.quantity),
    });
    setMovementLines((prev) => [...prev, nextLine]);
    if (movementForm.productId) {
      void loadLineUnitOptions(nextLine, {
        productId: movementForm.productId,
        lotId: nextLine.lotId,
        lotNo: nextLine.lotNo,
        expDate: nextLine.expDate,
      });
    }
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
        resetTransferLotLookup();
        clearMovementLinesState(isTransferOutMovement ? [] : [createMovementLine()]);
        setProductSearchStatus("ไม่พบสินค้าที่ตรงกับคำค้นหา");
        setMovementForm((prev) => ({
          ...prev,
          productId: "",
          productName: "",
          productCode: "",
        }));
        setFormErrors((prev) => ({
          ...prev,
          productId: "กรุณาค้นหาและเลือกสินค้า",
          lines: "",
        }));
        return;
      }

      resetTransferLotLookup();
      clearMovementLinesState(isTransferOutMovement ? [] : [createMovementLine()]);
      setMovementForm((prev) => ({
        ...prev,
        productId: "",
        productName: "",
        productCode: "",
      }));
      setProductSearchResults(list);
      setProductSearchStatus(`พบ ${list.length} รายการ โปรดเลือกสินค้า 1 รายการ`);
      setFormErrors((prev) => ({
        ...prev,
        productId: "กรุณาเลือกสินค้า 1 รายการจากผลค้นหา",
        lines: "",
      }));
    } catch (error) {
      resetTransferLotLookup();
      clearMovementLinesState(isTransferOutMovement ? [] : [createMovementLine()]);
      setMovementForm((prev) => ({
        ...prev,
        productId: "",
        productName: "",
        productCode: "",
      }));
      setProductSearchResults([]);
      setProductSearchStatus("");
      setProductSearchError(error?.message || "ค้นหาสินค้าไม่สำเร็จ");
    } finally {
      setIsSearchingProduct(false);
    }
  }

  function validateForm() {
    const nextFormErrors = {};
    const nextLineErrors = {};
    const transferUsageByLot = new Map();

    if (!movementForm.movementType) {
      nextFormErrors.movementType = "กรุณาเลือกประเภทการเคลื่อนไหว";
    }

    if (isFromRequired && !effectiveFromLocationId) {
      nextFormErrors.fromLocationId = "กรุณาเลือกสถานที่ต้นทาง";
    }

    if (isToRequired && !effectiveToLocationId) {
      nextFormErrors.toLocationId = "กรุณาเลือกสถานที่ปลายทาง";
    }

    if (
      effectiveFromLocationId &&
      effectiveToLocationId &&
      effectiveFromLocationId === effectiveToLocationId
    ) {
      nextFormErrors.toLocationId = "สถานที่ต้นทางและปลายทางต้องไม่ซ้ำกัน";
    }

    if (!isLoadingLocations) {
      if (!isFromLocked && isFromRequired && !fromLocationOptions.length) {
        nextFormErrors.fromLocationId = "ไม่พบรายการสถานที่ กรุณาลองใหม่";
      }
      if (!isToLocked && isToRequired && !locationOptions.length) {
        nextFormErrors.toLocationId = "ไม่พบรายการสถานที่ กรุณาลองใหม่";
      }
    }

    if (locationOptions.length > 0) {
      if (effectiveFromLocationId && !locationMap.has(effectiveFromLocationId)) {
        nextFormErrors.fromLocationId = "ไม่พบสถานที่ต้นทางที่เลือก";
      }
      if (effectiveToLocationId && !locationMap.has(effectiveToLocationId)) {
        nextFormErrors.toLocationId = "ไม่พบสถานที่ปลายทางที่เลือก";
      }
    }

    if (!movementForm.productId) {
      nextFormErrors.productId = "กรุณาค้นหาและเลือกสินค้า";
    }

    if (isTransferOutMovement) {
      if (isLoadingTransferLots) {
        nextFormErrors.lines = "กำลังโหลด lot คงเหลือจากฐานข้อมูล";
      } else if (!effectiveFromLocationId) {
        nextFormErrors.lines = "กรุณาเลือกสถานที่ต้นทางก่อน";
      } else if (!effectiveFromBranchCode) {
        nextFormErrors.lines = "สถานที่ต้นทางต้องเป็นสาขาเพื่อดึง lot คงเหลือ";
      } else if (!transferLotOptions.length) {
        nextFormErrors.lines =
          transferLotLoadError || "ไม่พบ lot คงเหลือของสินค้านี้ที่สาขาต้นทาง";
      } else if (!movementLines.length) {
        nextFormErrors.lines = "กรุณาเลือก lot อย่างน้อย 1 รายการ";
      }
    } else if (!movementLines.length) {
      nextFormErrors.lines = "กรุณาเพิ่มอย่างน้อย 1 บรรทัด";
    }

    movementLines.forEach((line, index) => {
      const currentLineErrors = {};
      const qtyNumber = Number(line?.qty);
      const unitOptions = getLineUnitOptions(line.id);
      const selectedUnitOption = getSelectedUnitOptionForLine(line);
      const isLoadingLineUnit = Boolean(lineUnitLoadingById[line.id]);
      const unitLoadError = toCleanText(lineUnitLoadErrorById[line.id]);
      const lineLabel = `บรรทัดที่ ${index + 1}`;

      if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) {
        currentLineErrors.qty = "กรุณาระบุจำนวนที่มากกว่า 0";
      } else if (selectedUnitOption?.requiresWholeQuantity && !Number.isInteger(qtyNumber)) {
        currentLineErrors.qty = "หน่วยที่เลือกต้องเป็นจำนวนเต็ม";
      }

      if (isLoadingLineUnit) {
        currentLineErrors.unit = "กำลังโหลดรายการหน่วย กรุณารอสักครู่";
      } else if (!toCleanText(line?.unitLevelId)) {
        currentLineErrors.unit = "กรุณาเลือกหน่วย";
      } else if (unitOptions.length > 0 && !selectedUnitOption) {
        currentLineErrors.unit = "หน่วยที่เลือกไม่ตรงกับ product_unit_levels";
      } else if (!unitOptions.length) {
        currentLineErrors.unit = unitLoadError || "ไม่พบหน่วยของสินค้านี้ใน product_unit_levels";
      }

      if (isTransferOutMovement) {
        const lotKey = getMovementLineLotKey(line);
        const stockOption = transferLotOptionsByKey.get(lotKey);

        if (!lotKey || !toCleanText(line?.lotId) || !stockOption) {
          currentLineErrors.lotNo = "กรุณาเลือก lot จาก stock ของสาขาต้นทาง";
        }
        if (!normalizeDateOnly(line?.expDate)) {
          currentLineErrors.expDate = "ไม่พบวันหมดอายุของ lot ที่เลือก";
        }

        const requestedQuantityBase = parseRequestedQuantityBase(line, selectedUnitOption);
        const availableQuantityBase = Number(stockOption?.quantity);
        if (
          Number.isFinite(requestedQuantityBase) &&
          Number.isFinite(availableQuantityBase) &&
          !currentLineErrors.lotNo &&
          !currentLineErrors.unit
        ) {
          if (!transferUsageByLot.has(lotKey)) {
            transferUsageByLot.set(lotKey, {
              requestedQuantityBase: 0,
              availableQuantityBase,
              lineIds: [],
            });
          }
          const usage = transferUsageByLot.get(lotKey);
          usage.requestedQuantityBase += requestedQuantityBase;
          usage.lineIds.push(line.id);
        }
      } else {
        if (!toCleanText(line?.lotNo)) {
          currentLineErrors.lotNo = "กรุณาระบุ lot number";
        }
        if (!normalizeDateOnly(line?.expDate)) {
          currentLineErrors.expDate = "กรุณาระบุวันหมดอายุ (Exp)";
        }
      }

      if (Object.keys(currentLineErrors).length > 0) {
        nextLineErrors[line.id] = currentLineErrors;
      } else if (movementLines.length > 1 && !movementForm.productId) {
        nextLineErrors[line.id] = {
          lotNo: `${lineLabel}: ยังไม่ได้เลือกสินค้า`,
        };
      }
    });

    transferUsageByLot.forEach((usage) => {
      if (usage.requestedQuantityBase <= usage.availableQuantityBase + 1e-9) {
        return;
      }

      usage.lineIds.forEach((lineId) => {
        nextLineErrors[lineId] = {
          ...(nextLineErrors[lineId] || {}),
          qty: `จำนวนรวมเกิน stock lot นี้ (คงเหลือ ${formatQty(usage.availableQuantityBase)} ฐาน)`,
        };
      });
    });

    setFormErrors(nextFormErrors);
    setLineErrors(nextLineErrors);
    return Object.keys(nextFormErrors).length === 0 && Object.keys(nextLineErrors).length === 0;
  }

  function buildMovementPayloads() {
    return movementLines.map((line) => {
      const payload = {
        movementType: movementForm.movementType,
        productId: movementForm.productId,
        qty: Number(line.qty),
        unitLevelId: line.unitLevelId,
        unitLabel: line.unitLabel,
        lotNo: toCleanText(line.lotNo),
        expDate: normalizeDateOnly(line.expDate),
      };

      if (toCleanText(line.lotId)) {
        payload.lotId = toCleanText(line.lotId);
      }

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

      return payload;
    });
  }

  function handleSaveMovement(event) {
    event.preventDefault();
    setPageError("");

    if (!isAdmin && !branchLocationId) {
      setPageError("ไม่พบ location_id ของผู้ใช้ กรุณาเข้าสู่ระบบใหม่");
      return;
    }
    if (!validateForm()) return;

    setIsMovementConfirmModalOpen(true);
  }

  async function handleConfirmSaveMovement() {
    setPageError("");
    setIsSavingMovement(true);

    const payloads = buildMovementPayloads();

    try {
      await inventoryApi.createMovementBatch(payloads);
      await loadMovements();
      closeMovementModal();
    } catch (error) {
      const failedRowNumber = Number(error?.payload?.details?.rowNumber);
      const errorMessage =
        error?.payload?.details?.reason || error?.message || "บันทึกรายการไม่สำเร็จ";
      closeMovementConfirmModal();
      setPageError(
        Number.isFinite(failedRowNumber) && failedRowNumber > 0
          ? `บันทึกแบบชุดไม่สำเร็จที่บรรทัด ${failedRowNumber}: ${errorMessage}`
          : errorMessage
      );
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

  function handleMovementConfirmModalBackdropClick(event) {
    if (event.target === event.currentTarget) {
      closeMovementConfirmModal();
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
          <div className="qcard modal-card movement-modal-card movement-modal-card--editor">
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
                    disabled={isLoadingLocations || !fromLocationOptions.length}
                    required={isFromRequired}
                  >
                    <option value="">
                      {isFromRequired ? "เลือกสถานที่ต้นทาง" : "ไม่ระบุ (ถ้ามี)"}
                    </option>
                    {fromLocationOptions.map((location) => (
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
                {hasAnyLineUnitLoading ? (
                  <div className="movement-search-status">
                    กำลังโหลดรายการหน่วยของ lot / packaging ที่เลือก...
                  </div>
                ) : null}
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

              <div className="movement-lines-card">
                <div className="movement-lines-toolbar">
                  <div className="movement-lines-toolbar-copy">
                    <strong>รายการ lot / packaging</strong>
                    <div className="movement-search-status">
                      {isTransferOutMovement
                        ? "เลือก lot จาก stock ของสาขาต้นทาง แล้วระบุจำนวนกับหน่วยที่ต้องการโอนออกต่อบรรทัด"
                        : "เพิ่มหลายบรรทัดได้ทั้ง lot ใหม่ lot เดิม หรือ packaging คนละระดับของสินค้าเดียวกัน"}
                    </div>
                  </div>
                  {!isTransferOutMovement ? (
                    <button
                      type="button"
                      className="btn btn--accent movement-inline-btn"
                      onClick={handleAddManualLine}
                      disabled={!movementForm.productId}
                    >
                      + เพิ่มบรรทัด
                    </button>
                  ) : null}
                </div>

                {formErrors.lines ? <div className="field-error">{formErrors.lines}</div> : null}

                {isTransferOutMovement ? (
                  <div className="movement-stock-picker">
                    <div className="movement-stock-picker-header">
                      <strong>stock lot ที่โอนได้จาก {getLocationLabel(effectiveFromLocationId)}</strong>
                      <span>
                        {movementForm.productId
                          ? "ติ๊กเลือก lot ที่ต้องการใช้ แล้วระบบจะเปิดบรรทัดให้กรอกจำนวนและหน่วยทันที"
                          : "เลือกสินค้าก่อนเพื่อดึง stock lot ของสาขาต้นทาง"}
                      </span>
                    </div>

                    {!movementForm.productId ? (
                      <div className="movement-lines-placeholder">เลือกสินค้าก่อนเพื่อดึง stock lot</div>
                    ) : !effectiveFromLocationId ? (
                      <div className="movement-lines-placeholder">เลือกสถานที่ต้นทางก่อน</div>
                    ) : !effectiveFromBranchCode ? (
                      <div className="movement-lines-placeholder">
                        สถานที่ต้นทางต้องเป็นสาขาเพื่อดึง stock จริงจากคลังสาขา
                      </div>
                    ) : isLoadingTransferLots ? (
                      <div className="movement-lines-placeholder">กำลังโหลด lot คงเหลือจากฐานข้อมูล...</div>
                    ) : transferLotOptions.length ? (
                      <div className="movement-stock-option-list">
                        {transferLotOptions.map((option) => {
                          const lotKey =
                            option.lotId || getLotOptionValue(option.lotNo, option.expDate);
                          const isChecked = selectedTransferLotKeys.has(lotKey);

                          return (
                            <label
                              key={lotKey}
                              className={`movement-stock-option${isChecked ? " is-selected" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(event) =>
                                  handleTransferLotToggle(option, event.target.checked)
                                }
                              />
                              <div className="movement-stock-option-copy">
                                <strong>{option.lotNo || "-"}</strong>
                                <span>หมดอายุ {formatDateOnlyDisplay(option.expDate)}</span>
                              </div>
                              <div className="movement-stock-option-qty">
                                {formatQuantityWithUnit(
                                  option.quantity,
                                  option.baseUnitLabel || option.unitLabel
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="movement-lines-placeholder">
                        {transferLotLoadError || "ไม่พบ lot คงเหลือของสินค้านี้ที่สาขาต้นทาง"}
                      </div>
                    )}

                    {transferLotLoadError && transferLotOptions.length ? (
                      <div className="field-error">{transferLotLoadError}</div>
                    ) : null}
                  </div>
                ) : null}

                <div
                  className={`movement-lines-table${
                    isTransferOutMovement ? " movement-lines-table--transfer" : ""
                  }`}
                >
                  <div className="movement-lines-head">
                    <div>เลขล็อต/เลขที่รุ่นการผลิต</div>
                    <div>วันหมดอายุ</div>
                    <div>
                      {movementForm.movementType === "RECEIVE"
                        ? "จำนวนรับเข้า"
                        : movementForm.movementType === "DISPENSE"
                        ? "จำนวนจ่ายออก"
                        : "จำนวนโอนออก"}
                    </div>
                    <div>หน่วย</div>
                    {isTransferOutMovement ? <div>stock คงเหลือ</div> : null}
                    <div className="right">จัดการ</div>
                  </div>

                  <div className="movement-lines-body">
                    {movementLineViewModels.length ? (
                      movementLineViewModels.map((lineView) => {
                        const { line, index, lineErrors: currentLineErrors } = lineView;
                        const unitPlaceholder = !movementForm.productId
                          ? "เลือกสินค้าก่อน"
                          : lineView.isUnitLoading
                          ? "กำลังโหลดรายการหน่วย..."
                          : "เลือกหน่วย";

                        return (
                          <div
                            key={line.id}
                            className={`movement-line-row${
                              isTransferOutMovement ? " movement-line-row--transfer" : ""
                            }`}
                          >
                            <div className="movement-line-cell">
                              <div className="movement-line-mobile-label">เลขล็อต/เลขที่รุ่นการผลิต</div>
                              {isTransferOutMovement ? (
                                <div className="movement-line-readonly">
                                  <strong>{line.lotNo || "-"}</strong>
                                  <span>บรรทัดที่ {index + 1}</span>
                                </div>
                              ) : (
                                <input
                                  id={`movementLotNo-${line.id}`}
                                  type="text"
                                  className="qinput"
                                  value={line.lotNo ?? ""}
                                  onChange={(event) =>
                                    handleLineFieldChange(line.id, "lotNo", event.target.value)
                                  }
                                  placeholder="เช่น LOT2402A"
                                  required
                                />
                              )}
                              {currentLineErrors.lotNo ? (
                                <div className="field-error">{currentLineErrors.lotNo}</div>
                              ) : null}
                            </div>

                            <div className="movement-line-cell">
                              <div className="movement-line-mobile-label">วันหมดอายุ</div>
                              {isTransferOutMovement ? (
                                <div className="movement-line-readonly">
                                  <strong>{formatDateOnlyDisplay(line.expDate)}</strong>
                                  <span>มาจาก stock จริงของสาขา</span>
                                </div>
                              ) : (
                                <input
                                  id={`movementExpDate-${line.id}`}
                                  type="date"
                                  className="qinput"
                                  value={line.expDate ?? ""}
                                  onChange={(event) =>
                                    handleLineFieldChange(line.id, "expDate", event.target.value)
                                  }
                                  required
                                />
                              )}
                              {currentLineErrors.expDate ? (
                                <div className="field-error">{currentLineErrors.expDate}</div>
                              ) : null}
                            </div>

                            <div className="movement-line-cell">
                              <div className="movement-line-mobile-label">
                                {movementForm.movementType === "RECEIVE"
                                  ? "จำนวนรับเข้า"
                                  : movementForm.movementType === "DISPENSE"
                                  ? "จำนวนจ่ายออก"
                                  : "จำนวนโอนออก"}
                              </div>
                              <input
                                id={`movementQty-${line.id}`}
                                type="number"
                                min="0"
                                step={lineView.qtyStep}
                                className="qinput"
                                value={line.qty ?? ""}
                                onChange={(event) =>
                                  handleLineFieldChange(line.id, "qty", event.target.value)
                                }
                                required
                              />
                              {currentLineErrors.qty ? (
                                <div className="field-error">{currentLineErrors.qty}</div>
                              ) : (
                                <div className="movement-search-status">
                                  {lineView.selectedUnitOption?.requiresWholeQuantity
                                    ? "หน่วยนี้รับเฉพาะจำนวนเต็ม"
                                    : "รองรับทศนิยมได้ถึง 3 ตำแหน่ง"}
                                </div>
                              )}
                            </div>

                            <div className="movement-line-cell">
                              <div className="movement-line-mobile-label">หน่วย</div>
                              <select
                                id={`movementUnit-${line.id}`}
                                className="qinput"
                                value={line.unitLevelId ?? ""}
                                onChange={(event) => handleLineUnitChange(line.id, event.target.value)}
                                disabled={
                                  !movementForm.productId ||
                                  lineView.isUnitLoading ||
                                  lineView.unitOptions.length === 0
                                }
                                required
                              >
                                <option value="">{unitPlaceholder}</option>
                                {lineView.unitOptions.map((unitOption) => (
                                  <option key={unitOption.id} value={unitOption.id}>
                                    {unitOption.displayName}
                                  </option>
                                ))}
                              </select>
                              {currentLineErrors.unit ? (
                                <div className="field-error">{currentLineErrors.unit}</div>
                              ) : lineView.unitLoadError ? (
                                <div className="movement-search-status">{lineView.unitLoadError}</div>
                              ) : null}
                            </div>

                            {isTransferOutMovement ? (
                              <div className="movement-line-cell">
                                <div className="movement-line-mobile-label">stock คงเหลือ</div>
                                <div className="movement-line-stock">
                                  <strong>
                                    {lineView.availableQuantityBase === null
                                      ? "-"
                                      : formatQuantityWithUnit(
                                          lineView.availableQuantityBase,
                                          lineView.availableUnitLabel
                                        )}
                                  </strong>
                                  <span>ดึงจาก lot คงเหลือของสาขาต้นทาง</span>
                                </div>
                              </div>
                            ) : null}

                            <div className="movement-line-cell movement-line-cell--actions">
                              <div className="movement-line-mobile-label">จัดการ</div>
                              <div className="movement-line-actions">
                                <span className="movement-line-index">บรรทัด {index + 1}</span>
                                <button
                                  type="button"
                                  className="btn movement-inline-btn"
                                  onClick={() => handleDuplicateLine(line.id)}
                                  disabled={!movementForm.productId}
                                >
                                  คัดลอก
                                </button>
                                <button
                                  type="button"
                                  className="btn movement-inline-btn"
                                  onClick={() => handleRemoveLine(line.id)}
                                  disabled={isSavingMovement}
                                >
                                  ลบ
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="movement-lines-placeholder">
                        {isTransferOutMovement
                          ? "ยังไม่ได้เลือก lot สำหรับโอนออก"
                          : "เพิ่มบรรทัดแรกหลังจากเลือกสินค้าเพื่อเริ่มกรอก lot / packaging"}
                      </div>
                    )}
                  </div>
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
                  {isSavingMovement ? "กำลังบันทึก..." : "ตรวจสอบก่อนบันทึก"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isMovementConfirmModalOpen ? (
        <div
          className="modal"
          aria-hidden="false"
          role="dialog"
          aria-modal="true"
          aria-labelledby="movement-confirm-modal-title"
          onClick={handleMovementConfirmModalBackdropClick}
        >
          <div className="qcard modal-card movement-modal-card movement-confirm-card">
            <div className="section-header">
              <strong id="movement-confirm-modal-title">ยืนยันรายการเคลื่อนไหวสินค้า</strong>
            </div>

            <div className="movement-confirm-summary">
              <div>
                <strong>ประเภท:</strong> {MOVEMENT_TYPE_LABEL[movementForm.movementType] || "-"}
              </div>
              <div>
                <strong>สินค้า:</strong> {movementForm.productName || "-"} ({movementForm.productCode || "-"})
              </div>
              <div>
                <strong>เส้นทาง:</strong> {movementDirectionSummary}
              </div>
              <div>
                <strong>จำนวนบรรทัด:</strong> {movementLineViewModels.length} บรรทัด
              </div>
            </div>

            <div
              className={`movement-confirm-table${
                isTransferOutMovement ? " movement-confirm-table--transfer" : ""
              }`}
            >
              <div className="movement-confirm-head">
                <div>Lot</div>
                <div>วันหมดอายุ</div>
                <div>จำนวน</div>
                <div>หน่วย</div>
                {isTransferOutMovement ? <div>stock ก่อนโอน</div> : null}
              </div>

              <div className="movement-confirm-body">
                {movementLineViewModels.map((lineView) => (
                  <div
                    key={`confirm-${lineView.line.id}`}
                    className={`movement-confirm-row${
                      isTransferOutMovement ? " movement-confirm-row--transfer" : ""
                    }`}
                  >
                    <div>
                      <div className="movement-line-mobile-label">Lot</div>
                      <strong>{lineView.line.lotNo || "-"}</strong>
                    </div>
                    <div>
                      <div className="movement-line-mobile-label">วันหมดอายุ</div>
                      <strong>{formatDateOnlyDisplay(lineView.line.expDate)}</strong>
                    </div>
                    <div>
                      <div className="movement-line-mobile-label">จำนวน</div>
                      <strong>
                        {formatQuantityWithUnit(
                          lineView.line.qty,
                          lineView.line.unitLabel || lineView.selectedUnitOption?.displayName
                        )}
                      </strong>
                    </div>
                    <div>
                      <div className="movement-line-mobile-label">หน่วย</div>
                      <strong>
                        {lineView.line.unitLabel || lineView.selectedUnitOption?.displayName || "-"}
                      </strong>
                    </div>
                    {isTransferOutMovement ? (
                      <div>
                        <div className="movement-line-mobile-label">stock ก่อนโอน</div>
                        <strong>
                          {lineView.availableQuantityBase === null
                            ? "-"
                            : formatQuantityWithUnit(
                                lineView.availableQuantityBase,
                                lineView.availableUnitLabel
                              )}
                        </strong>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="movement-search-status">
              เมื่อกดยืนยัน ระบบจะใช้เวลาปัจจุบัน ณ ตอนบันทึก และส่งรายการตามบรรทัดที่แสดงข้างต้น
            </div>

            <div className="modal-actions">
              <button
                className="btn"
                type="button"
                onClick={closeMovementConfirmModal}
                disabled={isSavingMovement}
              >
                กลับไปแก้ไข
              </button>
              <button
                className="btn btn--yellow"
                type="button"
                onClick={handleConfirmSaveMovement}
                disabled={isSavingMovement}
              >
                {isSavingMovement ? "กำลังบันทึก..." : "ยืนยันและบันทึก"}
              </button>
            </div>
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
