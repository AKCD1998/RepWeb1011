import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiRefreshCw,
  FiSearch,
  FiX,
} from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { dispenseApi, inventoryApi } from "../lib/api";
import { formatStructuredUnitLabel } from "../lib/productUnits";
import "./PatientPurchaseHistory.css";

const PAGE_SIZE_OPTIONS = [20, 50, 100];

function toCleanText(value) {
  return String(value || "").trim();
}

function normalizeRole(value) {
  return toCleanText(value).toUpperCase();
}

function createInitialFilters(user) {
  const role = normalizeRole(user?.role);
  const branchCode =
    role === "PHARMACIST" ? toCleanText(user?.branchCode || user?.branch_code || "") : "";

  return {
    q: "",
    pid: "",
    patientName: "",
    dateFrom: "",
    dateTo: "",
    branchCode,
    productName: "",
    lotNo: "",
  };
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(3).replace(/\.?0+$/, "");
}

function formatDateDisplay(value) {
  const text = toCleanText(value);
  if (!text) return "-";

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateTimeDisplay(value) {
  const text = toCleanText(value);
  if (!text) return "-";

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.replace("T", " ");

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function formatSexLabel(value) {
  const normalized = normalizeRole(value);
  if (normalized === "MALE") return "ชาย";
  if (normalized === "FEMALE") return "หญิง";
  if (normalized === "OTHER") return "อื่น ๆ";
  if (normalized === "UNKNOWN") return "ไม่ระบุ";
  return toCleanText(value) || "-";
}

function buildBranchLabel(branch) {
  const code = toCleanText(branch?.code);
  const name = toCleanText(branch?.name);
  if (code && name) return `${code} : ${name}`;
  return code || name || "-";
}

function buildPageTokens(currentPage, totalPages) {
  if (totalPages < 1) return [];
  if (totalPages === 1) return [1];

  const tokens = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) tokens.push("ellipsis-start");
  for (let page = start; page <= end; page += 1) {
    tokens.push(page);
  }
  if (end < totalPages - 1) tokens.push("ellipsis-end");
  tokens.push(totalPages);

  return tokens;
}

function getHistoryReturnState(item) {
  const status = normalizeRole(item?.returnStatus || item?.status);
  const returnedQuantity = Number(item?.returnedQuantity || 0);
  const remainingQuantity = Number(item?.remainingQuantity ?? item?.quantity ?? 0);

  if (status === "RETURNED" || (returnedQuantity > 0 && remainingQuantity <= 0)) {
    return "returned";
  }
  if (status === "PARTIALLY_RETURNED" || returnedQuantity > 0) {
    return "partial";
  }
  return "active";
}

function getHistoryReturnLabel(item) {
  const returnState = getHistoryReturnState(item);
  if (returnState === "returned") return "คืนสินค้าแล้ว";
  if (returnState === "partial") return "คืนสินค้าบางส่วน";
  return "";
}

export default function PatientPurchaseHistory() {
  const { user } = useAuth();
  const initialFilters = useMemo(() => createInitialFilters(user), [user]);
  const isPharmacist = normalizeRole(user?.role) === "PHARMACIST";

  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [activeFilters, setActiveFilters] = useState(initialFilters);
  const [items, setItems] = useState([]);
  const [branches, setBranches] = useState([]);
  const [expandedRows, setExpandedRows] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [pageError, setPageError] = useState("");
  const [branchError, setBranchError] = useState("");
  const [pagination, setPagination] = useState({
    page: 1,
    limit: PAGE_SIZE_OPTIONS[0],
    total: 0,
    totalPages: 0,
  });
  const [lastLoadedAt, setLastLoadedAt] = useState("");

  useEffect(() => {
    setDraftFilters(initialFilters);
    setActiveFilters(initialFilters);
    setPagination((prev) => ({
      ...prev,
      page: 1,
    }));
  }, [initialFilters]);

  const loadBranches = useCallback(async () => {
    setIsLoadingBranches(true);
    try {
      const rows = await inventoryApi.listLocations({
        includeInactive: false,
        locationType: "BRANCH",
      });
      setBranches(
        (Array.isArray(rows) ? rows : [])
          .map((row) => ({
            id: toCleanText(row?.id),
            code: toCleanText(row?.code),
            name: toCleanText(row?.name),
          }))
          .filter((row) => row.id || row.code || row.name)
      );
      setBranchError("");
    } catch (error) {
      setBranches([]);
      setBranchError(error?.message || "ไม่สามารถโหลดรายการสาขาได้");
    } finally {
      setIsLoadingBranches(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const payload = await dispenseApi.history({
        ...activeFilters,
        page: pagination.page,
        limit: pagination.limit,
      });
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setPagination((prev) => ({
        ...prev,
        total: Number(payload?.pagination?.total || 0),
        totalPages: Number(payload?.pagination?.totalPages || 0),
      }));
      setExpandedRows({});
      setLastLoadedAt(new Date().toISOString());
      setPageError("");
    } catch (error) {
      setItems([]);
      setPagination((prev) => ({
        ...prev,
        total: 0,
        totalPages: 0,
      }));
      setPageError(error?.message || "ไม่สามารถโหลดประวัติการจ่ายยาได้");
    } finally {
      setIsLoading(false);
    }
  }, [activeFilters, pagination.limit, pagination.page]);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const pageTokens = useMemo(
    () => buildPageTokens(pagination.page, pagination.totalPages),
    [pagination.page, pagination.totalPages]
  );
  const hasActiveFilters = useMemo(
    () => Object.values(activeFilters).some((value) => Boolean(toCleanText(value))),
    [activeFilters]
  );
  const resultSummary = useMemo(() => {
    if (!pagination.total) return "ไม่พบข้อมูลประวัติการจ่ายยา";
    return `พบ ${pagination.total.toLocaleString()} รายการ`;
  }, [pagination.total]);
  const userScopeText = useMemo(() => {
    if (!isPharmacist) return "แสดงข้อมูลตามตัวกรองที่เลือก";
    const branchCode = toCleanText(user?.branchCode || user?.branch_code);
    return branchCode
      ? `แสดงเฉพาะข้อมูลของสาขา ${branchCode}`
      : "แสดงเฉพาะข้อมูลตามสิทธิ์สาขาของผู้ใช้";
  }, [isPharmacist, user?.branchCode, user?.branch_code]);

  function setDraftField(field, value) {
    setDraftFilters((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    setActiveFilters(draftFilters);
    setPagination((prev) => ({
      ...prev,
      page: 1,
    }));
  }

  function handleResetFilters() {
    const nextFilters = createInitialFilters(user);
    setDraftFilters(nextFilters);
    setActiveFilters(nextFilters);
    setPagination((prev) => ({
      ...prev,
      page: 1,
    }));
  }

  function handleRefresh() {
    void loadHistory();
  }

  function handlePageChange(nextPage) {
    if (nextPage < 1) return;
    if (pagination.totalPages > 0 && nextPage > pagination.totalPages) return;
    setPagination((prev) => ({
      ...prev,
      page: nextPage,
    }));
  }

  function handlePageSizeChange(event) {
    const nextLimit = Number(event.target.value) || PAGE_SIZE_OPTIONS[0];
    setPagination((prev) => ({
      ...prev,
      page: 1,
      limit: nextLimit,
    }));
  }

  function toggleExpanded(lineId) {
    const key = toCleanText(lineId);
    if (!key) return;
    setExpandedRows((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

  return (
    <section className="patient-history-page">
      <header className="patient-history-hero">
        <div>
          <p className="patient-history-eyebrow">Dispense History</p>
          <h1>ประวัติการจ่ายยา / ประวัติการซื้อยา</h1>
          <p className="patient-history-subtitle">
            ใช้สืบค้นรายการจ่ายยาแบบย้อนหลังตามคนไข้ สาขา ยา Lot และช่วงวันที่
          </p>
        </div>
        <div className="patient-history-hero-meta">
          <div className="patient-history-stat">
            <span>ผลลัพธ์</span>
            <strong>{resultSummary}</strong>
          </div>
          <div className="patient-history-stat">
            <span>ขอบเขตข้อมูล</span>
            <strong>{userScopeText}</strong>
          </div>
          <div className="patient-history-stat">
            <span>อัปเดตล่าสุด</span>
            <strong>{lastLoadedAt ? formatDateTimeDisplay(lastLoadedAt) : "-"}</strong>
          </div>
        </div>
      </header>

      <form className="patient-history-toolbar" onSubmit={handleSearchSubmit}>
        <div className="patient-history-search-row">
          <label className="patient-history-search-field" htmlFor="history-global-search">
            <span>ค้นหาแบบรวม</span>
            <div className="patient-history-search-input">
              <FiSearch aria-hidden="true" />
              <input
                id="history-global-search"
                type="text"
                value={draftFilters.q}
                onChange={(event) => setDraftField("q", event.target.value)}
                placeholder="PID, ชื่อผู้ป่วย, ชื่อยา, lot, สาขา, ผู้จ่ายยา"
              />
            </div>
          </label>
          <div className="patient-history-toolbar-actions">
            <button type="submit" className="patient-history-btn patient-history-btn--primary">
              ค้นหา
            </button>
            <button
              type="button"
              className="patient-history-btn"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <FiRefreshCw aria-hidden="true" />
              รีเฟรช
            </button>
            <button type="button" className="patient-history-btn" onClick={handleResetFilters}>
              <FiX aria-hidden="true" />
              ล้างตัวกรอง
            </button>
          </div>
        </div>

        <div className="patient-history-filter-grid">
          <label>
            PID
            <input
              type="text"
              value={draftFilters.pid}
              onChange={(event) => setDraftField("pid", event.target.value)}
              placeholder="เช่น 1103000134333"
            />
          </label>
          <label>
            ชื่อผู้ป่วย
            <input
              type="text"
              value={draftFilters.patientName}
              onChange={(event) => setDraftField("patientName", event.target.value)}
              placeholder="ชื่อ-สกุล"
            />
          </label>
          <label>
            ตั้งแต่วันที่
            <input
              type="date"
              value={draftFilters.dateFrom}
              onChange={(event) => setDraftField("dateFrom", event.target.value)}
            />
          </label>
          <label>
            ถึงวันที่
            <input
              type="date"
              value={draftFilters.dateTo}
              onChange={(event) => setDraftField("dateTo", event.target.value)}
            />
          </label>
          <label>
            สาขา
            <select
              value={draftFilters.branchCode}
              onChange={(event) => setDraftField("branchCode", event.target.value)}
              disabled={isLoadingBranches}
            >
              <option value="">
                {isLoadingBranches ? "กำลังโหลดสาขา..." : "ทุกสาขา"}
              </option>
              {branches.map((branch) => (
                <option key={`${branch.id}-${branch.code}`} value={branch.code}>
                  {buildBranchLabel(branch)}
                </option>
              ))}
            </select>
          </label>
          <label>
            ชื่อยา/สินค้า
            <input
              type="text"
              value={draftFilters.productName}
              onChange={(event) => setDraftField("productName", event.target.value)}
              placeholder="ชื่อยา หรือรหัสสินค้า"
            />
          </label>
          <label>
            Lot Number
            <input
              type="text"
              value={draftFilters.lotNo}
              onChange={(event) => setDraftField("lotNo", event.target.value)}
              placeholder="เช่น LOT2402A"
            />
          </label>
          <label>
            แสดงต่อหน้า
            <select value={pagination.limit} onChange={handlePageSizeChange}>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} รายการ
                </option>
              ))}
            </select>
          </label>
        </div>

        {branchError ? <div className="patient-history-alert error">{branchError}</div> : null}
        {hasActiveFilters ? (
          <div className="patient-history-filter-note">กำลังแสดงข้อมูลตามตัวกรองที่เลือก</div>
        ) : (
          <div className="patient-history-filter-note">
            ยังไม่ระบุตัวกรองเพิ่มเติม ระบบจะแสดงข้อมูลล่าสุดทั้งหมดตามสิทธิ์ของผู้ใช้
          </div>
        )}
      </form>

      {pageError ? <div className="patient-history-alert error">{pageError}</div> : null}

      <section className="patient-history-results">
        <div className="patient-history-results-head">
          <div>
            <strong>{resultSummary}</strong>
            <p>
              เหมาะสำหรับตรวจสอบย้อนหลังว่าจ่ายยาอะไร Lot ไหน จำนวนเท่าไหร่ และเมื่อใด
            </p>
          </div>
          <div className="patient-history-pagination-summary">
            หน้า {pagination.page}
            {pagination.totalPages ? ` / ${pagination.totalPages}` : ""}
          </div>
        </div>

        <div className="patient-history-table-wrap">
          <table className="patient-history-table">
            <thead>
              <tr>
                <th aria-label="ดูรายละเอียด"></th>
                <th>วันที่จ่าย</th>
                <th>PID</th>
                <th>ชื่อผู้ป่วย</th>
                <th>สาขา</th>
                <th>ชื่อยา/สินค้า</th>
                <th>Lot</th>
                <th>จำนวน</th>
                <th>หน่วย</th>
                <th>เภสัชกร/ผู้จ่าย</th>
                <th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={11} className="patient-history-placeholder">
                    กำลังโหลดข้อมูลประวัติการจ่ายยา...
                  </td>
                </tr>
              ) : items.length ? (
                items.map((item) => {
                  const lineId = toCleanText(item?.lineId || `${item?.headerId || "history"}-${item?.lineNo || "0"}`);
                  const isExpanded = Boolean(expandedRows[lineId]);
                  const returnState = getHistoryReturnState(item);
                  const returnLabel = getHistoryReturnLabel(item);
                  const notePreview =
                    toCleanText(item?.lineNote) || toCleanText(item?.headerNote) || "-";

                  return (
                    <Fragment key={lineId}>
                      <tr
                        className={[
                          isExpanded ? "is-expanded" : "",
                          returnState !== "active" ? `is-${returnState}` : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <td>
                          <button
                            type="button"
                            className="patient-history-expand-btn"
                            onClick={() => toggleExpanded(lineId)}
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? "ซ่อนรายละเอียด" : "ดูรายละเอียด"}
                          >
                            {isExpanded ? <FiChevronDown /> : <FiChevronRight />}
                          </button>
                        </td>
                        <td>{formatDateTimeDisplay(item?.dispensedAt)}</td>
                        <td>{item?.pid || "-"}</td>
                        <td>{item?.patientName || "-"}</td>
                        <td>{item?.branchCode ? `${item.branchCode} : ${item.branchName || "-"}` : "-"}</td>
                        <td>
                          <div className="patient-history-product-cell">
                            <strong>{item?.tradeName || "-"}</strong>
                            <span>{item?.productCode || "-"}</span>
                            {returnLabel ? (
                              <span className={`patient-history-return-badge is-${returnState}`}>{returnLabel}</span>
                            ) : null}
                          </div>
                        </td>
                        <td>{item?.lotNo || "-"}</td>
                        <td className="patient-history-number-cell">{formatNumber(item?.quantity)}</td>
                        <td>{formatStructuredUnitLabel(item?.unitLabel) || "-"}</td>
                        <td>{item?.pharmacistName || item?.pharmacistUsername || "-"}</td>
                        <td className="patient-history-note-cell" title={notePreview}>
                          {notePreview}
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="patient-history-detail-row">
                          <td colSpan={11}>
                            <div className="patient-history-detail-grid">
                              <section className="patient-history-detail-card">
                                <h3>ข้อมูลผู้ป่วย</h3>
                                <dl>
                                  <div>
                                    <dt>ชื่อ</dt>
                                    <dd>{item?.patientName || "-"}</dd>
                                  </div>
                                  <div>
                                    <dt>PID</dt>
                                    <dd>{item?.pid || "-"}</dd>
                                  </div>
                                  <div>
                                    <dt>วันเกิด</dt>
                                    <dd>{formatDateDisplay(item?.birthDate)}</dd>
                                  </div>
                                  <div>
                                    <dt>เพศ</dt>
                                    <dd>{formatSexLabel(item?.sex)}</dd>
                                  </div>
                                  <div>
                                    <dt>ออกบัตรที่</dt>
                                    <dd>{item?.cardIssuePlace || "-"}</dd>
                                  </div>
                                  <div>
                                    <dt>วันออกบัตร</dt>
                                    <dd>{formatDateDisplay(item?.cardIssuedDate)}</dd>
                                  </div>
                                  <div>
                                    <dt>วันหมดอายุ</dt>
                                    <dd>{formatDateDisplay(item?.cardExpiryDate)}</dd>
                                  </div>
                                  <div className="patient-history-detail-span">
                                    <dt>ที่อยู่</dt>
                                    <dd>{item?.addressText || "-"}</dd>
                                  </div>
                                </dl>
                              </section>

                              <section className="patient-history-detail-card">
                                <h3>ข้อมูลรายการจ่ายยา</h3>
                                <dl>
                                  <div>
                                    <dt>วันที่จ่าย</dt>
                                    <dd>{formatDateTimeDisplay(item?.dispensedAt)}</dd>
                                  </div>
                                  <div>
                                    <dt>สาขา</dt>
                                    <dd>
                                      {item?.branchCode
                                        ? `${item.branchCode} : ${item?.branchName || "-"}`
                                        : "-"}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>ชื่อยา</dt>
                                    <dd>{item?.tradeName || "-"}</dd>
                                  </div>
                                  <div>
                                    <dt>รหัสสินค้า</dt>
                                    <dd>{item?.productCode || "-"}</dd>
                                  </div>
                                  <div>
                                    <dt>Lot</dt>
                                    <dd>{item?.lotNo || "-"}</dd>
                                  </div>
                                  <div>
                                    <dt>จำนวน</dt>
                                    <dd>{formatNumber(item?.quantity)}</dd>
                                  </div>
                                  <div>
                                    <dt>สถานะการคืน</dt>
                                    <dd>{returnLabel || "ปกติ"}</dd>
                                  </div>
                                  <div>
                                    <dt>จำนวนที่คืนแล้ว</dt>
                                    <dd>{formatNumber(item?.returnedQuantity || 0)}</dd>
                                  </div>
                                  <div>
                                    <dt>จำนวนที่ยังนับในรายงาน</dt>
                                    <dd>{formatNumber(item?.remainingQuantity ?? item?.quantity)}</dd>
                                  </div>
                                  <div>
                                    <dt>หน่วย</dt>
                                    <dd>{formatStructuredUnitLabel(item?.unitLabel) || "-"}</dd>
                                  </div>
                                  <div>
                                    <dt>ผู้จ่าย</dt>
                                    <dd>{item?.pharmacistName || item?.pharmacistUsername || "-"}</dd>
                                  </div>
                                </dl>
                              </section>

                              <section className="patient-history-detail-card">
                                <h3>หมายเหตุ</h3>
                                <div className="patient-history-note-block">
                                  <strong>หมายเหตุระดับรายการ</strong>
                                  <p>{item?.lineNote || "ไม่มีหมายเหตุระดับรายการ"}</p>
                                </div>
                                <div className="patient-history-note-block">
                                  <strong>หมายเหตุระดับการจ่าย</strong>
                                  <p>{item?.headerNote || "ไม่มีหมายเหตุระดับรายการหลัก"}</p>
                                </div>
                              </section>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={11} className="patient-history-placeholder">
                    ไม่พบข้อมูลประวัติการจ่ายยาตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="patient-history-pagination">
          <button
            type="button"
            className="patient-history-page-btn"
            onClick={() => handlePageChange(pagination.page - 1)}
            disabled={pagination.page <= 1 || isLoading}
          >
            <FiChevronLeft aria-hidden="true" />
            ก่อนหน้า
          </button>

          <div className="patient-history-page-list">
            {pageTokens.map((token) =>
              typeof token === "number" ? (
                <button
                  key={token}
                  type="button"
                  className={`patient-history-page-btn${token === pagination.page ? " is-active" : ""}`}
                  onClick={() => handlePageChange(token)}
                  disabled={isLoading}
                >
                  {token}
                </button>
              ) : (
                <span key={token} className="patient-history-page-ellipsis">
                  ...
                </span>
              )
            )}
          </div>

          <button
            type="button"
            className="patient-history-page-btn"
            onClick={() => handlePageChange(pagination.page + 1)}
            disabled={
              isLoading || !pagination.totalPages || pagination.page >= pagination.totalPages
            }
          >
            ถัดไป
            <FiChevronRight aria-hidden="true" />
          </button>
        </div>
      </section>
    </section>
  );
}
