import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "../lib/api";
import { buildDeliverNotesFromCard } from "../utils/deliverSmartcard";
import "./AdminPatients.css";

const PAGE_SIZE_OPTIONS = [50, 100, 250];

function toCleanText(value) {
  return String(value ?? "").trim();
}

function formatDate(value) {
  const text = toCleanText(value);
  if (!text) return "-";

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value) {
  const text = toCleanText(value);
  if (!text) return "-";

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return date.toLocaleString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSexLabel(value) {
  const normalized = toCleanText(value).toUpperCase();
  if (normalized === "MALE") return "ชาย";
  if (normalized === "FEMALE") return "หญิง";
  if (normalized === "OTHER") return "อื่น ๆ";
  if (normalized === "UNKNOWN") return "ไม่ระบุ";
  return toCleanText(value) || "-";
}

function buildPatientAddress(patient) {
  const rawText = toCleanText(patient?.addressText);
  if (rawText) return rawText;

  const parts = [
    patient?.addressLine1,
    patient?.addressLine2,
    patient?.subdistrict,
    patient?.district,
    patient?.province,
    patient?.postalCode,
    toCleanText(patient?.country) && toCleanText(patient?.country).toUpperCase() !== "TH"
      ? patient?.country
      : "",
  ]
    .map((part) => toCleanText(part))
    .filter(Boolean);

  return parts.join(" ") || "-";
}

function buildPatientDeliverTemplate(patient) {
  if (!patient) return "-";

  const note = buildDeliverNotesFromCard({
    thaiName: toCleanText(patient?.fullName),
    fullName: toCleanText(patient?.fullName),
    cid: toCleanText(patient?.pid),
    birthDate: patient?.birthDate || "",
    gender: patient?.sex || "",
    address: buildPatientAddress(patient),
  });

  return note || "-";
}

async function copyTextToClipboard(text) {
  const safeText = String(text ?? "");
  if (!safeText) return;

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(safeText);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = safeText;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function AdminPatients() {
  const [patients, setPatients] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [offset, setOffset] = useState(0);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [pageError, setPageError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const canGoPrevious = offset > 0;
  const canGoNext = offset + patients.length < totalCount;

  const selectedPatientTemplate = useMemo(
    () => buildPatientDeliverTemplate(selectedPatient),
    [selectedPatient]
  );

  const totalText = useMemo(() => {
    const parts = [`แสดง ${patients.length.toLocaleString("th-TH")} รายชื่อ`];
    parts.push(`ทั้งหมด ${totalCount.toLocaleString("th-TH")} รายชื่อ`);
    if (appliedSearch) {
      parts.push(`ค้นหา: ${appliedSearch}`);
    }
    return parts.join(" • ");
  }, [appliedSearch, patients.length, totalCount]);

  const loadPatients = useCallback(async () => {
    setIsLoading(true);
    try {
      const payload = await adminApi.listPatients({
        q: appliedSearch || undefined,
        limit: pageSize,
        offset,
      });

      setPatients(Array.isArray(payload?.items) ? payload.items : []);
      setTotalCount(Number(payload?.total || 0));
      setPageError("");
    } catch (error) {
      setPatients([]);
      setTotalCount(0);
      setPageError(error?.message || "ไม่สามารถโหลดข้อมูลผู้ป่วยได้");
    } finally {
      setIsLoading(false);
    }
  }, [appliedSearch, offset, pageSize]);

  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);

  useEffect(() => {
    if (!selectedPatient) return undefined;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setSelectedPatient(null);
        setCopyStatus("");
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedPatient]);

  function handleSearchSubmit(event) {
    event.preventDefault();
    setAppliedSearch(toCleanText(searchInput));
    setOffset(0);
  }

  function handleClearSearch() {
    setSearchInput("");
    setAppliedSearch("");
    setOffset(0);
  }

  function handlePageSizeChange(event) {
    const nextValue = Number(event.target.value);
    setPageSize(Number.isFinite(nextValue) ? nextValue : 50);
    setOffset(0);
  }

  function openPatientModal(patient) {
    setSelectedPatient(patient || null);
    setCopyStatus("");
  }

  async function handleCopyTemplate() {
    if (!selectedPatientTemplate || selectedPatientTemplate === "-" || isCopying) return;

    setIsCopying(true);
    try {
      await copyTextToClipboard(selectedPatientTemplate);
      setCopyStatus("คัดลอก template ลง clipboard แล้ว");
    } catch (error) {
      setCopyStatus(error?.message || "คัดลอกข้อความไม่สำเร็จ");
    } finally {
      setIsCopying(false);
    }
  }

  return (
    <section className="outerpad admin-patients-page">
      <div className="qgrid admin-patients-top">
        <section className="qcard admin-patients-hero">
          <div className="section-header">
            <strong>รายชื่อผู้ป่วยในฐานข้อมูล</strong>
          </div>
          <p>
            หน้านี้สำหรับ admin เท่านั้น ใช้ค้นหาผู้ป่วย ดูข้อมูลรายละเอียด และคัดลอก template
            ข้อมูลผู้เสียบบัตรแบบเดียวกับหน้า Deliver
          </p>
        </section>

        <section className="qcard admin-patients-search">
          <div className="section-header">
            <strong>ค้นหาผู้ป่วย</strong>
          </div>
          <form className="admin-patients-search-row" onSubmit={handleSearchSubmit}>
            <label htmlFor="admin-patient-search">ข้อมูลค้นหา</label>
            <input
              id="admin-patient-search"
              type="text"
              className="qinput"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="ชื่อผู้ป่วย / PID / ที่อยู่ / จังหวัด / รหัสไปรษณีย์"
            />
            <button type="submit" className="btn btn--accent" disabled={isLoading}>
              {isLoading ? "กำลังค้นหา..." : "ค้นหา"}
            </button>
          </form>
          <div className="admin-patients-search-actions">
            <button type="button" className="btn" onClick={handleClearSearch} disabled={isLoading}>
              ล้างคำค้น
            </button>
          </div>
        </section>
      </div>

      <div className="qgrid admin-patients-config">
        <div className="qcard admin-patients-config-bar">
          <label className="page-size-label" htmlFor="admin-patient-page-size">
            <span>แสดง</span>
            <select
              id="admin-patient-page-size"
              className="qinput"
              value={pageSize}
              onChange={handlePageSizeChange}
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} รายการ
                </option>
              ))}
            </select>
            <span>ต่อหน้า</span>
          </label>

          <div className="table-totals">{totalText}</div>

          <div className="admin-patients-pager">
            <button
              type="button"
              className="btn"
              onClick={() => setOffset((current) => Math.max(current - pageSize, 0))}
              disabled={!canGoPrevious || isLoading}
            >
              ก่อนหน้า
            </button>
            <span>
              หน้า {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => setOffset((current) => current + pageSize)}
              disabled={!canGoNext || isLoading}
            >
              ถัดไป
            </button>
          </div>
        </div>
      </div>

      {pageError ? <div className="qcard page-error">{pageError}</div> : null}

      <div className="qcard results-card">
        <div className="pos-table admin-patients-table">
          <div className="thead">
            <div>ลำดับ</div>
            <div>ชื่อผู้ป่วย</div>
            <div>PID</div>
            <div>วันเกิด</div>
            <div>เพศ</div>
            <div>ส่งมอบล่าสุด</div>
          </div>
          <div className="tbody">
            {isLoading ? (
              <div className="row row--placeholder">
                <div className="center">...</div>
                <div>กำลังโหลดรายชื่อผู้ป่วย</div>
                <div className="center">...</div>
                <div className="center">...</div>
                <div className="center">...</div>
                <div className="center">...</div>
              </div>
            ) : patients.length ? (
              patients.map((patient, index) => (
                <div key={patient?.id || `${patient?.pid || "patient"}-${index}`} className="row">
                  <div className="center">{offset + index + 1}</div>
                  <div className="admin-patients-name-cell">
                    <button
                      type="button"
                      className="admin-patients-name-button"
                      onClick={() => openPatientModal(patient)}
                    >
                      {toCleanText(patient?.fullName) || "-"}
                    </button>
                  </div>
                  <div>{toCleanText(patient?.pid) || "-"}</div>
                  <div>{formatDate(patient?.birthDate)}</div>
                  <div>{getSexLabel(patient?.sex)}</div>
                  <div>{formatDateTime(patient?.lastDispensedAt)}</div>
                </div>
              ))
            ) : (
              <div className="row row--placeholder">
                <div className="center">-</div>
                <div>ไม่พบรายชื่อผู้ป่วยตามเงื่อนไขที่ค้นหา</div>
                <div className="center">-</div>
                <div className="center">-</div>
                <div className="center">-</div>
                <div className="center">-</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedPatient ? (
        <div
          className="modal"
          aria-hidden="false"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-patient-modal-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedPatient(null);
              setCopyStatus("");
            }
          }}
        >
          <div className="qcard modal-card admin-patients-modal-card">
            <div className="section-header admin-patients-modal-header">
              <div>
                <strong id="admin-patient-modal-title">
                  {toCleanText(selectedPatient?.fullName) || "รายละเอียดผู้ป่วย"}
                </strong>
                <span>PID: {toCleanText(selectedPatient?.pid) || "-"}</span>
              </div>
              <button type="button" className="btn" onClick={() => setSelectedPatient(null)}>
                ปิด
              </button>
            </div>

            <div className="admin-patients-detail-grid">
              <div>
                <span>ชื่อผู้ป่วย</span>
                <strong>{toCleanText(selectedPatient?.fullName) || "-"}</strong>
              </div>
              <div>
                <span>เลขประจำตัวประชาชน</span>
                <strong>{toCleanText(selectedPatient?.pid) || "-"}</strong>
              </div>
              <div>
                <span>วันเกิด</span>
                <strong>{formatDate(selectedPatient?.birthDate)}</strong>
              </div>
              <div>
                <span>เพศ</span>
                <strong>{getSexLabel(selectedPatient?.sex)}</strong>
              </div>
              <div>
                <span>ออกบัตรที่</span>
                <strong>{toCleanText(selectedPatient?.cardIssuePlace) || "-"}</strong>
              </div>
              <div>
                <span>วันออกบัตร</span>
                <strong>{formatDate(selectedPatient?.cardIssuedDate)}</strong>
              </div>
              <div>
                <span>วันหมดอายุบัตร</span>
                <strong>{formatDate(selectedPatient?.cardExpiryDate)}</strong>
              </div>
              <div>
                <span>จำนวนครั้งที่ส่งมอบ</span>
                <strong>{Number(selectedPatient?.dispenseCount || 0).toLocaleString("th-TH")}</strong>
              </div>
              <div>
                <span>ส่งมอบล่าสุด</span>
                <strong>{formatDateTime(selectedPatient?.lastDispensedAt)}</strong>
              </div>
              <div>
                <span>สร้างข้อมูล</span>
                <strong>{formatDateTime(selectedPatient?.createdAt)}</strong>
              </div>
              <div>
                <span>อัปเดตล่าสุด</span>
                <strong>{formatDateTime(selectedPatient?.updatedAt)}</strong>
              </div>
              <div>
                <span>ประเทศ</span>
                <strong>{toCleanText(selectedPatient?.country) || "TH"}</strong>
              </div>
            </div>

            <section className="admin-patients-detail-section">
              <h3>ที่อยู่</h3>
              <p>{buildPatientAddress(selectedPatient)}</p>
            </section>

            <section className="admin-patients-detail-section">
              <div className="admin-patients-template-header">
                <div>
                  <h3>Template ผู้เสียบบัตรสำหรับหน้า Deliver</h3>
                  <span>คัดลอกไปใช้เป็นข้อความประกอบการส่งมอบยาได้ทันที</span>
                </div>
                <button
                  type="button"
                  className="btn btn--yellow"
                  onClick={() => {
                    void handleCopyTemplate();
                  }}
                  disabled={isCopying || selectedPatientTemplate === "-"}
                >
                  {isCopying ? "กำลังคัดลอก..." : "Copy to clipboard"}
                </button>
              </div>

              {copyStatus ? <div className="admin-patients-copy-status">{copyStatus}</div> : null}

              <pre className="admin-patients-template">{selectedPatientTemplate}</pre>
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
