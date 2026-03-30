import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiBell, FiCheck, FiClock, FiPackage, FiRefreshCw, FiX } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { inventoryApi, INVENTORY_CHANGED_EVENT } from "../lib/api";
import "./TransferNotifications.css";

const REFRESH_INTERVAL_MS = 15000;

function toCleanText(value) {
  return String(value || "").trim();
}

function formatQty(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value || "-");
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(3).replace(/\.?0+$/, "");
}

function formatDateTime(value) {
  const text = toCleanText(value);
  if (!text) return "-";

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;

  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function formatDateOnly(value) {
  const text = toCleanText(value);
  if (!text) return "-";
  const matchedDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (matchedDate?.[1]) return matchedDate[1];
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString().slice(0, 10);
}

function buildRequestPreview(request) {
  const name = toCleanText(request?.tradeName) || toCleanText(request?.productCode) || "สินค้า";
  const qtyText = formatQty(request?.quantity);
  const unitLabel = toCleanText(request?.unitLabel);
  return `${name}${qtyText !== "-" ? ` • ${qtyText}${unitLabel ? ` ${unitLabel}` : ""}` : ""}`;
}

export default function TransferNotifications() {
  const { user } = useAuth();
  const dropdownRef = useRef(null);
  const userRole = toCleanText(user?.role).toUpperCase();
  const canReviewTransfers = userRole === "ADMIN" || Boolean(user?.location_id);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState("");
  const [actionError, setActionError] = useState("");
  const [isActing, setIsActing] = useState(false);

  const pendingCount = requests.length;
  const dropdownLabel = useMemo(() => {
    if (!pendingCount) return "ไม่มีรายการโอนรอยืนยัน";
    return `มี ${pendingCount} รายการโอนรอยืนยัน`;
  }, [pendingCount]);

  const loadRequests = useCallback(async (options = {}) => {
    const silent = options.silent === true;
    if (!canReviewTransfers) {
      setRequests([]);
      setLoadError("");
      setIsLoading(false);
      return;
    }

    if (!silent) {
      setIsLoading(true);
    }

    try {
      const rows = await inventoryApi.listTransferRequests({
        status: "PENDING",
        limit: 20,
      });
      setRequests(Array.isArray(rows) ? rows : []);
      setLoadError("");
    } catch (error) {
      setLoadError(error?.message || "ไม่สามารถโหลดรายการโอนรอยืนยันได้");
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [canReviewTransfers]);

  useEffect(() => {
    if (!canReviewTransfers) return undefined;

    void loadRequests();

    const handleRefresh = () => {
      void loadRequests({ silent: true });
    };

    const intervalId = window.setInterval(handleRefresh, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", handleRefresh);
    window.addEventListener(INVENTORY_CHANGED_EVENT, handleRefresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener(INVENTORY_CHANGED_EVENT, handleRefresh);
    };
  }, [canReviewTransfers, loadRequests]);

  useEffect(() => {
    if (!isDropdownOpen) return undefined;

    function handlePointerDown(event) {
      if (!dropdownRef.current?.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isDropdownOpen]);

  if (!canReviewTransfers) {
    return null;
  }

  function closeDetailModal() {
    if (isActing) return;
    setSelectedRequest(null);
    setActionError("");
  }

  function closeRejectModal() {
    if (isActing) return;
    setRejectTarget(null);
    setRejectReason("");
    setRejectError("");
  }

  async function handleAccept() {
    if (!selectedRequest?.id) return;

    setIsActing(true);
    setActionError("");
    try {
      await inventoryApi.acceptTransferRequest(selectedRequest.id);
      setSelectedRequest(null);
      await loadRequests({ silent: true });
    } catch (error) {
      setActionError(error?.message || "ยืนยันรับสินค้าไม่สำเร็จ");
    } finally {
      setIsActing(false);
    }
  }

  function handleOpenRejectModal() {
    if (!selectedRequest) return;
    setRejectTarget(selectedRequest);
    setRejectReason("");
    setRejectError("");
  }

  async function handleRejectSubmit(event) {
    event.preventDefault();
    const reason = toCleanText(rejectReason);
    if (!rejectTarget?.id) return;
    if (!reason) {
      setRejectError("กรุณาระบุเหตุผลที่ไม่รับสินค้า");
      return;
    }

    setIsActing(true);
    setRejectError("");
    setActionError("");
    try {
      await inventoryApi.rejectTransferRequest(rejectTarget.id, { reason });
      setRejectTarget(null);
      setSelectedRequest(null);
      setRejectReason("");
      await loadRequests({ silent: true });
    } catch (error) {
      setRejectError(error?.message || "ปฏิเสธรับสินค้าไม่สำเร็จ");
    } finally {
      setIsActing(false);
    }
  }

  return (
    <>
      <div className="transfer-notifications" ref={dropdownRef}>
        <button
          type="button"
          className={`transfer-bell-button${isDropdownOpen ? " is-open" : ""}`}
          onClick={() => setIsDropdownOpen((prev) => !prev)}
          aria-label={dropdownLabel}
          title={dropdownLabel}
        >
          <FiBell />
          {pendingCount > 0 ? <span className="transfer-bell-badge">{pendingCount}</span> : null}
        </button>

        {isDropdownOpen ? (
          <div className="transfer-dropdown" role="dialog" aria-label="รายการโอนรอยืนยัน">
            <div className="transfer-dropdown-header">
              <div>
                <strong>แจ้งเตือนการโอน</strong>
                <div className="transfer-dropdown-subtitle">{dropdownLabel}</div>
              </div>
              <button
                type="button"
                className="transfer-refresh-button"
                onClick={() => void loadRequests()}
                disabled={isLoading}
                aria-label="รีเฟรชรายการโอน"
              >
                <FiRefreshCw />
              </button>
            </div>

            {loadError ? <div className="transfer-dropdown-error">{loadError}</div> : null}

            <div className="transfer-dropdown-list">
              {isLoading && requests.length === 0 ? (
                <div className="transfer-dropdown-empty">กำลังโหลดรายการโอน...</div>
              ) : requests.length > 0 ? (
                requests.map((request) => (
                  <button
                    key={request.id}
                    type="button"
                    className="transfer-dropdown-item"
                    onClick={() => {
                      setSelectedRequest(request);
                      setActionError("");
                      setIsDropdownOpen(false);
                    }}
                  >
                    <span className="transfer-dropdown-item-title">{buildRequestPreview(request)}</span>
                    <span className="transfer-dropdown-item-meta">
                      จาก {toCleanText(request?.fromBranchCode) || "-"} • {formatDateTime(request?.requestedAt)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="transfer-dropdown-empty">ยังไม่มีรายการโอนที่รอยืนยัน</div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {selectedRequest ? (
        <div className="transfer-modal-backdrop" onClick={closeDetailModal}>
          <div
            className="transfer-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="transfer-modal-header">
              <div>
                <strong id="transfer-detail-title">ตรวจสอบรายการโอนสินค้า</strong>
                <div className="transfer-modal-subtitle">
                  จาก {toCleanText(selectedRequest?.fromBranchCode) || "-"} ไป{" "}
                  {toCleanText(selectedRequest?.toBranchCode) || "-"}
                </div>
              </div>
              <button
                type="button"
                className="transfer-modal-close"
                onClick={closeDetailModal}
                disabled={isActing}
                aria-label="ปิดรายละเอียดรายการโอน"
              >
                <FiX />
              </button>
            </div>

            <div className="transfer-detail-grid">
              <div className="transfer-detail-item">
                <span className="transfer-detail-label">เวลาโอนออก</span>
                <span className="transfer-detail-value">
                  <FiClock /> {formatDateTime(selectedRequest?.requestedAt)}
                </span>
              </div>
              <div className="transfer-detail-item">
                <span className="transfer-detail-label">ผู้ทำรายการ</span>
                <span className="transfer-detail-value">
                  {toCleanText(selectedRequest?.requestedByName) || "-"}
                </span>
              </div>
              <div className="transfer-detail-item transfer-detail-item--wide">
                <span className="transfer-detail-label">สินค้า</span>
                <span className="transfer-detail-value">
                  <FiPackage /> {toCleanText(selectedRequest?.tradeName) || "-"}
                </span>
              </div>
              <div className="transfer-detail-item">
                <span className="transfer-detail-label">รหัสสินค้า</span>
                <span className="transfer-detail-value">
                  {toCleanText(selectedRequest?.productCode) || "-"}
                </span>
              </div>
              <div className="transfer-detail-item">
                <span className="transfer-detail-label">บาร์โค้ด</span>
                <span className="transfer-detail-value">
                  {toCleanText(selectedRequest?.barcode) || "-"}
                </span>
              </div>
              <div className="transfer-detail-item">
                <span className="transfer-detail-label">Lot Number</span>
                <span className="transfer-detail-value">{toCleanText(selectedRequest?.lotNo) || "-"}</span>
              </div>
              <div className="transfer-detail-item">
                <span className="transfer-detail-label">วันหมดอายุ</span>
                <span className="transfer-detail-value">{formatDateOnly(selectedRequest?.expDate)}</span>
              </div>
              <div className="transfer-detail-item transfer-detail-item--wide">
                <span className="transfer-detail-label">จำนวน</span>
                <span className="transfer-detail-value">
                  {formatQty(selectedRequest?.quantity)} {toCleanText(selectedRequest?.unitLabel)}
                </span>
              </div>
              {toCleanText(selectedRequest?.note) ? (
                <div className="transfer-detail-item transfer-detail-item--wide">
                  <span className="transfer-detail-label">หมายเหตุจากต้นทาง</span>
                  <span className="transfer-detail-note">{selectedRequest.note}</span>
                </div>
              ) : null}
            </div>

            {actionError ? <div className="transfer-dropdown-error">{actionError}</div> : null}

            <div className="transfer-modal-actions">
              <button
                type="button"
                className="transfer-action-button transfer-action-button--ghost"
                onClick={handleOpenRejectModal}
                disabled={isActing}
              >
                ไม่รับสินค้า
              </button>
              <button
                type="button"
                className="transfer-action-button transfer-action-button--primary"
                onClick={handleAccept}
                disabled={isActing}
              >
                <FiCheck /> {isActing ? "กำลังยืนยัน..." : "ยืนยันรับสินค้า"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rejectTarget ? (
        <div className="transfer-modal-backdrop transfer-modal-backdrop--stacked" onClick={closeRejectModal}>
          <div
            className="transfer-modal-card transfer-modal-card--compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-reject-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="transfer-modal-header">
              <div>
                <strong id="transfer-reject-title">ระบุเหตุผลที่ไม่รับสินค้า</strong>
                <div className="transfer-modal-subtitle">
                  {toCleanText(rejectTarget?.tradeName) || toCleanText(rejectTarget?.productCode) || "-"}
                </div>
              </div>
              <button
                type="button"
                className="transfer-modal-close"
                onClick={closeRejectModal}
                disabled={isActing}
                aria-label="ปิดหน้าปฏิเสธรับสินค้า"
              >
                <FiX />
              </button>
            </div>

            <form className="transfer-reject-form" onSubmit={handleRejectSubmit}>
              <label className="transfer-detail-label" htmlFor="transferRejectReason">
                เหตุผล
              </label>
              <textarea
                id="transferRejectReason"
                className="transfer-reject-textarea"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="เช่น สินค้าไม่ตรงกับใบโอน / จำนวนไม่ถูกต้อง / lot ไม่ตรง"
                rows={5}
                disabled={isActing}
                required
              />
              {rejectError ? <div className="transfer-dropdown-error">{rejectError}</div> : null}
              <div className="transfer-modal-actions">
                <button
                  type="button"
                  className="transfer-action-button transfer-action-button--ghost"
                  onClick={closeRejectModal}
                  disabled={isActing}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="transfer-action-button transfer-action-button--danger"
                  disabled={isActing}
                >
                  {isActing ? "กำลังส่งคำตอบ..." : "ยืนยันไม่รับสินค้า"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
