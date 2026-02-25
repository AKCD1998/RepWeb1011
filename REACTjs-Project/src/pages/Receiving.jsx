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

function createInitialMovementForm() {
  return {
    movementType: "RECEIVE",
    locationText: "",
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

export default function Receiving() {
  const { user } = useAuth();
  const branchLocationId = String(user?.location_id || "").trim();

  const [movements, setMovements] = useState([]);
  const [isLoadingMovements, setIsLoadingMovements] = useState(false);
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [isSavingMovement, setIsSavingMovement] = useState(false);
  const [isSearchingProduct, setIsSearchingProduct] = useState(false);
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [productSearchError, setProductSearchError] = useState("");
  const [movementForm, setMovementForm] = useState(createInitialMovementForm);
  const [formErrors, setFormErrors] = useState({});
  const [pageError, setPageError] = useState("");
  const [productSearchStatus, setProductSearchStatus] = useState("");

  const tableColumns = ["เวลา", "สินค้า", "รหัสสินค้า", "ประเภท", "การเปลี่ยนแปลงสต๊อก"];

  const showLocationField = movementForm.movementType !== "DISPENSE";
  const locationLabel = movementForm.movementType === "RECEIVE" ? "แหล่งที่มา" : "ปลายทาง (รหัสสาขา)";
  const locationPlaceholder =
    movementForm.movementType === "RECEIVE"
      ? "เช่น สำนักงานใหญ่ / ร้านขายส่ง / บริษัทยา"
      : "เช่น 001 หรือ 003";
  const totalText = useMemo(() => `รวม ${movements.length} รายการ`, [movements.length]);

  const loadMovements = useCallback(async () => {
    if (!branchLocationId) {
      setMovements([]);
      return;
    }

    setIsLoadingMovements(true);
    try {
      const rows = await inventoryApi.listMovements({
        location_id: branchLocationId,
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
  }, [branchLocationId]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

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
    if (!branchLocationId) {
      setPageError("ไม่พบ location_id ของผู้ใช้ กรุณาเข้าสู่ระบบใหม่");
      return;
    }
    setMovementForm(createInitialMovementForm());
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
    setMovementForm((prev) => ({
      ...prev,
      movementType: nextType,
      locationText: nextType === "DISPENSE" ? "" : prev.locationText,
    }));
    setFormErrors((prev) => ({
      ...prev,
      movementType: "",
      locationText: "",
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
    if (movementForm.movementType === "DISPENSE") {
      errors.movementType = "ยังไม่รองรับการบันทึกแบบส่งมอบลูกค้าในหน้านี้";
    }
    if (showLocationField && !String(movementForm.locationText || "").trim()) {
      errors.locationText = `กรุณาระบุ${locationLabel}`;
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

    if (!branchLocationId) {
      setPageError("ไม่พบ location_id ของผู้ใช้ กรุณาเข้าสู่ระบบใหม่");
      return;
    }
    if (!validateForm()) return;

    setIsSavingMovement(true);
    try {
      await inventoryApi.createMovement({
        movementType: movementForm.movementType,
        productId: movementForm.productId,
        qty: Number(movementForm.qty),
        unitLabel: movementForm.unit,
        occurredAt: movementForm.occurredAt,
        locationText: movementForm.locationText,
        toBranchCode:
          movementForm.movementType === "TRANSFER_OUT" ? movementForm.locationText : undefined,
      });

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

              {showLocationField ? (
                <div className="field-block">
                  <label htmlFor="locationText">{locationLabel}</label>
                  <input
                    id="locationText"
                    type="text"
                    className="qinput"
                    value={movementForm.locationText}
                    onChange={(event) => setField("locationText", event.target.value)}
                    placeholder={locationPlaceholder}
                    required={showLocationField}
                  />
                  {formErrors.locationText ? (
                    <div className="field-error">{formErrors.locationText}</div>
                  ) : null}
                </div>
              ) : null}

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
