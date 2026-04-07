import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import AdminIncidentModal from "../components/AdminIncidentModal";
import { adminApi, inventoryApi } from "../lib/api";
import {
  ADMIN_INCIDENT_STATUS_OPTIONS,
  ADMIN_INCIDENT_TYPE_OPTIONS,
  formatAdminIncidentDateTime,
  getAdminIncidentReasonLabel,
  getAdminIncidentStatusLabel,
  getAdminIncidentTypeLabel,
} from "../lib/adminIncidents";
import "./AdminIncidentReports.css";

function toCleanText(value) {
  return String(value ?? "").trim();
}

function createEmptyFilters() {
  return {
    fromDate: "",
    toDate: "",
    branchCode: "",
    incidentType: "",
    status: "",
  };
}

function buildIncidentPreview(text, maxLength = 120) {
  const singleLine = toCleanText(text).replace(/\s+/g, " ");
  if (!singleLine) return "-";
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

export default function AdminIncidentReports() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(() => createEmptyFilters());
  const [branches, setBranches] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [listError, setListError] = useState("");
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [pageSuccess, setPageSuccess] = useState("");

  const adminLabel = useMemo(
    () => toCleanText(user?.full_name || user?.username || "ADMIN"),
    [user]
  );

  useEffect(() => {
    let isCancelled = false;

    async function loadBranches() {
      try {
        const response = await inventoryApi.listLocations({ locationType: "BRANCH" });
        if (!isCancelled) {
          setBranches(Array.isArray(response) ? response : []);
        }
      } catch (error) {
        if (!isCancelled) {
          setListError(toCleanText(error?.message) || "โหลดรายการสาขาไม่สำเร็จ");
        }
      }
    }

    void loadBranches();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadIncidents() {
      setIsLoadingList(true);
      setListError("");
      try {
        const response = await adminApi.listIncidents({
          ...filters,
          limit: 200,
        });
        if (isCancelled) return;

        const rows = Array.isArray(response?.items) ? response.items : [];
        setIncidents(rows);

        if (selectedIncidentId && !rows.some((row) => toCleanText(row?.id) === selectedIncidentId)) {
          setSelectedIncidentId("");
          setSelectedIncident(null);
          setStatusDraft("");
        }
      } catch (error) {
        if (!isCancelled) {
          setListError(toCleanText(error?.message) || "โหลด incident reports ไม่สำเร็จ");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingList(false);
        }
      }
    }

    void loadIncidents();
    return () => {
      isCancelled = true;
    };
  }, [filters]);

  useEffect(() => {
    if (!selectedIncidentId) {
      setSelectedIncident(null);
      setDetailError("");
      setStatusDraft("");
      return;
    }

    let isCancelled = false;

    async function loadIncidentDetail() {
      setIsLoadingDetail(true);
      setDetailError("");
      try {
        const response = await adminApi.getIncident(selectedIncidentId);
        if (isCancelled) return;

        const incident = response?.incident || null;
        setSelectedIncident(incident);
        setStatusDraft(toCleanText(incident?.status).toUpperCase());
      } catch (error) {
        if (!isCancelled) {
          setDetailError(toCleanText(error?.message) || "โหลดรายละเอียด incident ไม่สำเร็จ");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingDetail(false);
        }
      }
    }

    void loadIncidentDetail();
    return () => {
      isCancelled = true;
    };
  }, [selectedIncidentId]);

  function handleFilterChange(field, value) {
    setFilters((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSaveStatus() {
    if (!selectedIncidentId || !statusDraft || isSavingStatus) {
      return;
    }

    setIsSavingStatus(true);
    setDetailError("");
    setPageSuccess("");

    try {
      const response = await adminApi.updateIncidentStatus(selectedIncidentId, {
        status: statusDraft,
      });
      const incident = response?.incident || null;
      setSelectedIncident(incident);
      setStatusDraft(toCleanText(incident?.status).toUpperCase());
      setIncidents((current) =>
        current.map((row) =>
          toCleanText(row?.id) === toCleanText(incident?.id)
            ? {
                ...row,
                status: incident?.status || row?.status,
              }
            : row
        )
      );
      setPageSuccess(
        `อัปเดตสถานะ incident ${toCleanText(incident?.incidentCode) || ""} เป็น ${getAdminIncidentStatusLabel(
          incident?.status
        )} สำเร็จ`
      );
    } catch (error) {
      setDetailError(toCleanText(error?.message) || "อัปเดตสถานะ incident ไม่สำเร็จ");
    } finally {
      setIsSavingStatus(false);
    }
  }

  async function handleIncidentCreated(incident) {
    const incidentId = toCleanText(incident?.id);
    setPageSuccess(`บันทึก incident report สำเร็จ (${toCleanText(incident?.incidentCode) || incidentId})`);

    try {
      const response = await adminApi.listIncidents({
        ...filters,
        limit: 200,
      });
      const rows = Array.isArray(response?.items) ? response.items : [];
      setIncidents(rows);
    } catch {
      // Ignore list refresh failure here; the success toast still matters more than auto-refresh.
    }

    if (incidentId) {
      setSelectedIncidentId(incidentId);
      setSelectedIncident(incident);
      setStatusDraft(toCleanText(incident?.status).toUpperCase());
    }
  }

  return (
    <section className="admin-incident-page">
      <header className="admin-incident-page__header">
        <div>
          <p className="admin-incident-page__eyebrow">Admin Governance</p>
          <h1>Incident Reports</h1>
          <p>
            ระบบนี้ใช้เก็บเหตุผิดปกติแยกจาก dispense โดยเด็ดขาด เพื่อรองรับ audit,
            accountability และการตามงานย้อนหลังโดยไม่แตะ patient หรือ stock ledger
          </p>
        </div>
        <div className="admin-incident-page__session-card">
          <strong>{adminLabel}</strong>
          <span>สิทธิ์ ADMIN</span>
          <button type="button" className="admin-incident-page__primary" onClick={() => setIsCreateModalOpen(true)}>
            สร้าง incident report
          </button>
        </div>
      </header>

      {pageSuccess ? <div className="admin-incident-page__feedback admin-incident-page__feedback--success">{pageSuccess}</div> : null}
      {listError ? <div className="admin-incident-page__feedback admin-incident-page__feedback--error">{listError}</div> : null}

      <section className="admin-incident-page__card">
        <div className="admin-incident-page__card-header">
          <div>
            <h2>Filters</h2>
            <p>กรองตามวันที่เกิดเหตุ, สาขา, ประเภท incident และสถานะ</p>
          </div>
          <button type="button" className="admin-incident-page__secondary" onClick={() => setFilters(createEmptyFilters())}>
            ล้างตัวกรอง
          </button>
        </div>

        <div className="admin-incident-page__filters">
          <label>
            <span>From date</span>
            <input
              type="date"
              value={filters.fromDate}
              onChange={(event) => handleFilterChange("fromDate", event.target.value)}
            />
          </label>

          <label>
            <span>To date</span>
            <input
              type="date"
              value={filters.toDate}
              onChange={(event) => handleFilterChange("toDate", event.target.value)}
            />
          </label>

          <label>
            <span>Branch</span>
            <select
              value={filters.branchCode}
              onChange={(event) => handleFilterChange("branchCode", event.target.value)}
            >
              <option value="">ทุกสาขา</option>
              {branches.map((branch) => {
                const code = toCleanText(branch?.code);
                return (
                  <option key={code || branch?.id} value={code}>
                    {code ? `${code} : ${toCleanText(branch?.name) || "-"}` : toCleanText(branch?.name) || "-"}
                  </option>
                );
              })}
            </select>
          </label>

          <label>
            <span>Incident type</span>
            <select
              value={filters.incidentType}
              onChange={(event) => handleFilterChange("incidentType", event.target.value)}
            >
              <option value="">ทุกประเภท</option>
              {ADMIN_INCIDENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Status</span>
            <select value={filters.status} onChange={(event) => handleFilterChange("status", event.target.value)}>
              <option value="">ทุกสถานะ</option>
              {ADMIN_INCIDENT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <div className="admin-incident-page__layout">
        <section className="admin-incident-page__card">
          <div className="admin-incident-page__card-header">
            <div>
              <h2>Incident List</h2>
              <p>{isLoadingList ? "กำลังโหลดรายการ..." : `${incidents.length} รายการ`}</p>
            </div>
          </div>

          {isLoadingList ? (
            <div className="admin-incident-page__state">กำลังโหลด incident reports...</div>
          ) : incidents.length ? (
            <div className="admin-incident-page__table-wrap">
              <table className="admin-incident-page__table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Happened</th>
                    <th>Branch</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Reporter</th>
                    <th>Preview</th>
                    <th>Items</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((incident) => {
                    const incidentId = toCleanText(incident?.id);
                    const isSelected = incidentId && incidentId === selectedIncidentId;
                    return (
                      <tr
                        key={incidentId || incident?.incidentCode}
                        className={isSelected ? "is-selected" : ""}
                        onClick={() => setSelectedIncidentId(incidentId)}
                      >
                        <td>{toCleanText(incident?.incidentCode) || "-"}</td>
                        <td>{formatAdminIncidentDateTime(incident?.happenedAt)}</td>
                        <td>
                          {toCleanText(incident?.branchCode)
                            ? `${toCleanText(incident?.branchCode)} : ${toCleanText(incident?.branchName) || "-"}`
                            : "-"}
                        </td>
                        <td>{getAdminIncidentTypeLabel(incident?.incidentType)}</td>
                        <td>
                          <span className={`admin-incident-page__status admin-incident-page__status--${toCleanText(incident?.status).toLowerCase()}`}>
                            {getAdminIncidentStatusLabel(incident?.status)}
                          </span>
                        </td>
                        <td>{toCleanText(incident?.reporterName) || toCleanText(incident?.reporterUsername) || "-"}</td>
                        <td>{buildIncidentPreview(incident?.incidentDescription)}</td>
                        <td>{Number(incident?.itemCount || 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-incident-page__state">ยังไม่พบ incident reports ตามเงื่อนไขที่เลือก</div>
          )}
        </section>

        <aside className="admin-incident-page__card admin-incident-page__detail">
          <div className="admin-incident-page__card-header">
            <div>
              <h2>Incident Detail</h2>
              <p>ดู metadata, item snapshots และอัปเดตสถานะของ incident</p>
            </div>
          </div>

          {detailError ? <div className="admin-incident-page__feedback admin-incident-page__feedback--error">{detailError}</div> : null}

          {!selectedIncidentId ? (
            <div className="admin-incident-page__state">เลือก incident จากตารางเพื่อดูรายละเอียด</div>
          ) : isLoadingDetail ? (
            <div className="admin-incident-page__state">กำลังโหลดรายละเอียด incident...</div>
          ) : selectedIncident ? (
            <div className="admin-incident-page__detail-content">
              <div className="admin-incident-page__detail-grid">
                <div>
                  <strong>Incident code</strong>
                  <span>{toCleanText(selectedIncident?.incidentCode) || "-"}</span>
                </div>
                <div>
                  <strong>Status</strong>
                  <span>{getAdminIncidentStatusLabel(selectedIncident?.status)}</span>
                </div>
                <div>
                  <strong>Type</strong>
                  <span>{getAdminIncidentTypeLabel(selectedIncident?.incidentType)}</span>
                </div>
                <div>
                  <strong>Reason</strong>
                  <span>{getAdminIncidentReasonLabel(selectedIncident?.incidentReason)}</span>
                </div>
                <div>
                  <strong>Branch</strong>
                  <span>
                    {toCleanText(selectedIncident?.branchCode)
                      ? `${toCleanText(selectedIncident?.branchCode)} : ${toCleanText(selectedIncident?.branchName) || "-"}`
                      : "-"}
                  </span>
                </div>
                <div>
                  <strong>Reporter</strong>
                  <span>
                    {toCleanText(selectedIncident?.reporterName) ||
                      toCleanText(selectedIncident?.reporterUsername) ||
                      "-"}
                  </span>
                </div>
                <div>
                  <strong>Happened at</strong>
                  <span>{formatAdminIncidentDateTime(selectedIncident?.happenedAt)}</span>
                </div>
                <div>
                  <strong>Reported at</strong>
                  <span>{formatAdminIncidentDateTime(selectedIncident?.reportedAt)}</span>
                </div>
                <div>
                  <strong>Acknowledged by</strong>
                  <span>
                    {toCleanText(selectedIncident?.acknowledgedByAdminName) ||
                      toCleanText(selectedIncident?.acknowledgedByAdminUsername) ||
                      "-"}
                  </span>
                </div>
                <div>
                  <strong>Closed at</strong>
                  <span>{formatAdminIncidentDateTime(selectedIncident?.closedAt)}</span>
                </div>
                <div>
                  <strong>Smartcard session</strong>
                  <span>{toCleanText(selectedIncident?.smartcardSessionId) || "-"}</span>
                </div>
                <div>
                  <strong>Dispense attempt</strong>
                  <span>{toCleanText(selectedIncident?.dispenseAttemptId) || "-"}</span>
                </div>
              </div>

              <section className="admin-incident-page__detail-block">
                <h3>Description</h3>
                <p>{toCleanText(selectedIncident?.incidentDescription) || "-"}</p>
              </section>

              <section className="admin-incident-page__detail-block">
                <h3>Note / reference</h3>
                <p>{toCleanText(selectedIncident?.noteText) || "-"}</p>
              </section>

              <section className="admin-incident-page__detail-block">
                <div className="admin-incident-page__detail-block-header">
                  <h3>Status update</h3>
                </div>
                <div className="admin-incident-page__status-editor">
                  <select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)} disabled={isSavingStatus}>
                    {ADMIN_INCIDENT_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="admin-incident-page__primary"
                    onClick={() => void handleSaveStatus()}
                    disabled={isSavingStatus || !statusDraft || statusDraft === toCleanText(selectedIncident?.status).toUpperCase()}
                  >
                    {isSavingStatus ? "กำลังบันทึก..." : "อัปเดตสถานะ"}
                  </button>
                </div>
              </section>

              <section className="admin-incident-page__detail-block">
                <h3>Related items</h3>
                {Array.isArray(selectedIncident?.items) && selectedIncident.items.length ? (
                  <div className="admin-incident-page__table-wrap">
                    <table className="admin-incident-page__table admin-incident-page__table--detail">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Product</th>
                          <th>Lot snapshot</th>
                          <th>EXP snapshot</th>
                          <th>Qty</th>
                          <th>Unit</th>
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedIncident.items.map((item) => (
                          <tr key={toCleanText(item?.id) || item?.lineNo}>
                            <td>{Number(item?.lineNo || 0)}</td>
                            <td>
                              <div className="admin-incident-page__product-cell">
                                <strong>{toCleanText(item?.productNameSnapshot) || "-"}</strong>
                                <span>{toCleanText(item?.productCodeSnapshot) || "-"}</span>
                              </div>
                            </td>
                            <td>{toCleanText(item?.lotNoSnapshot) || "-"}</td>
                            <td>{toCleanText(item?.expDateSnapshot) || "-"}</td>
                            <td>{Number(item?.qty || 0)}</td>
                            <td>{toCleanText(item?.unitLabelSnapshot) || "-"}</td>
                            <td>{toCleanText(item?.noteText) || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="admin-incident-page__state admin-incident-page__state--compact">
                    incident นี้ไม่มี item rows
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="admin-incident-page__state">ไม่พบรายละเอียด incident ที่เลือก</div>
          )}
        </aside>
      </div>

      <AdminIncidentModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={(incident) => void handleIncidentCreated(incident)}
      />
    </section>
  );
}
