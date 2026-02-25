import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { inventoryApi, productsApi } from "../lib/api";
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

const SUPPORTED_TABLE_TYPES = new Set(["RECEIVE", "TRANSFER_OUT", "DISPENSE"]);
const PRODUCT_SEARCH_LIMIT = 20;

function toDateTimeLocalValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatOccurredAtDisplay(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).replace("T", " ");
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
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
    qty: "",
    unit: "",
    occurredAt: toDateTimeLocalValue(),
  };
}

function mapMovementRecord(row) {
  return {
    id: row?.id || `row-${Math.random().toString(36).slice(2)}`,
    occurredAt: formatOccurredAtDisplay(row?.occurredAt),
    productName: row?.tradeName || row?.productName || "-",
    productCode: row?.productCode || "-",
    movementType: String(row?.movementType || "").toUpperCase(),
    qtyValue: Number(row?.quantity ?? row?.qtyValue ?? 0),
    unit: String(row?.unitLabel || row?.unit || "").trim(),
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

function getDeltaText(movement) {
  const qtyText = formatQty(movement?.qtyValue);
  const unit = String(movement?.unit || "").trim();
  const sign = isPositiveMovement(movement?.movementType) ? "+" : "-";
  return `${sign}${qtyText}${unit ? ` ${unit}` : ""}`;
}

export default function Receiving() {
  const { user } = useAuth();
  const userRole = normalizeRole(user?.role);
  const isAdmin = userRole === "ADMIN";
  const branchLocationId = toCleanText(user?.location_id);

  const [movements, setMovements] = useState([]);
  const [locations, setLocations] = useState([]);
  const [isLoadingMovements, setIsLoadingMovements] = useState(false);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [isSavingMovement, setIsSavingMovement] = useState(false);
  const [isSearchingProduct, setIsSearchingProduct] = useState(false);
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [productSearchError, setProductSearchError] = useState("");
  const [locationLoadError, setLocationLoadError] = useState("");
  const [movementForm, setMovementForm] = useState(() =>
    createInitialMovementForm({ isAdmin, branchLocationId })
  );
  const [formErrors, setFormErrors] = useState({});
  const [pageError, setPageError] = useState("");
  const [productSearchStatus, setProductSearchStatus] = useState("");

  const tableColumns = ["เวลา", "สินค้า", "รหัสสินค้า", "ประเภท", "การเปลี่ยนแปลงสต๊อก"];
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
    void loadLocations();
  }, [loadLocations]);

  useEffect(() => {
    if (!isMovementModalOpen) return undefined;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsMovementModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isMovementModalOpen]);

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
    setIsMovementModalOpen(true);
  }

  function closeMovementModal() {
    setIsMovementModalOpen(false);
  }

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

  function handleProductSearchInputChange(event) {
    const keyword = event.target.value;
    setMovementForm((prev) => ({
      ...prev,
      productSearch: keyword,
      productId: "",
      productName: "",
      productCode: "",
    }));
    setProductSearchResults([]);
    setProductSearchError("");
    setProductSearchStatus("");
    setFormErrors((prev) => ({
      ...prev,
      productId: "",
    }));
  }

  function handleSelectProduct(product) {
    setMovementForm((prev) => ({
      ...prev,
      productId: product.id,
      productName: product.tradeName,
      productCode: product.productCode,
      unit: prev.unit || product.unitSymbol || prev.unit,
    }));
    setProductSearchError("");
    setProductSearchStatus(`เลือกสินค้าแล้ว: ${product.tradeName}`);
    setFormErrors((prev) => ({
      ...prev,
      productId: "",
    }));
  }

  function handleMovementTypeChange(event) {
    const nextType = event.target.value;
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
    setFormErrors((prev) => ({
      ...prev,
      movementType: "",
      fromLocationId: "",
      toLocationId: "",
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
          unitSymbol: String(row?.unitSymbol || ""),
        }))
        .filter((row) => row.id);

      if (!list.length) {
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
        }));
        return;
      }

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
      }));
    } catch (error) {
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
    const errors = {};
    const qtyNumber = Number(movementForm.qty);

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
    if (!String(movementForm.unit || "").trim()) {
      errors.unit = "กรุณาระบุหน่วย";
    }
    if (!String(movementForm.occurredAt || "").trim()) {
      errors.occurredAt = "กรุณาระบุวันและเวลา";
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
        unitLabel: movementForm.unit,
        occurredAt: movementForm.occurredAt,
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

  function handleModalBackdropClick(event) {
    if (event.target === event.currentTarget) {
      closeMovementModal();
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
                <div className="right">...</div>
              </div>
            ) : movements.length > 0 ? (
              movements.map((movement, index) => (
                <div
                  key={movement?.id || `${movement?.productCode || "mv"}-${index}`}
                  className="row"
                >
                  <div>{movement?.occurredAt || "-"}</div>
                  <div>{movement?.productName || "-"}</div>
                  <div>{movement?.productCode || "-"}</div>
                  <div>
                    <span className={`movement-type-badge ${getMovementTypeClass(movement?.movementType)}`}>
                      {MOVEMENT_TYPE_LABEL[movement?.movementType] || movement?.movementType || "-"}
                    </span>
                  </div>
                  <div className={`right movement-delta ${getDeltaClass(movement?.movementType)}`}>
                    {getDeltaText(movement)}
                  </div>
                </div>
              ))
            ) : (
              <div className="row row--placeholder">
                <div className="center">-</div>
                <div>ยังไม่มีข้อมูลรายการเคลื่อนไหว</div>
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
                  value={movementForm.movementType}
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
                    value={movementForm.fromLocationId}
                    onChange={(event) => setField("fromLocationId", event.target.value)}
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
                      value={movementForm.toLocationId}
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
                    value={movementForm.productSearch}
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
                    value={movementForm.qty}
                    onChange={(event) => setField("qty", event.target.value)}
                    required
                  />
                  {formErrors.qty ? <div className="field-error">{formErrors.qty}</div> : null}
                </div>

                <div className="field-block">
                  <label htmlFor="movementUnit">หน่วย</label>
                  <input
                    id="movementUnit"
                    type="text"
                    className="qinput"
                    value={movementForm.unit}
                    onChange={(event) => setField("unit", event.target.value)}
                    placeholder="เช่น กล่อง / แผง / ขวด"
                    required
                  />
                  {formErrors.unit ? <div className="field-error">{formErrors.unit}</div> : null}
                </div>
              </div>

              <div className="field-block">
                <label htmlFor="movementOccurredAt">วันเวลาเกิดรายการ</label>
                <input
                  id="movementOccurredAt"
                  type="datetime-local"
                  className="qinput"
                  value={movementForm.occurredAt}
                  onChange={(event) => setField("occurredAt", event.target.value)}
                  required
                />
                {formErrors.occurredAt ? (
                  <div className="field-error">{formErrors.occurredAt}</div>
                ) : null}
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
