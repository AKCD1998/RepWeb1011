import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import AdminIncidentModal from "../components/AdminIncidentModal";
import { adminApi, inventoryApi, productsApi } from "../lib/api";
import { formatDateOnlyDisplay, normalizeDateOnlyInput } from "../lib/dateOnly";
import {
  ADMIN_INCIDENT_REASON_OPTIONS,
  ADMIN_INCIDENT_STATUS_OPTIONS,
  ADMIN_INCIDENT_TYPE_OPTIONS,
  createAdminIncidentLocalDateTimeValue,
  formatAdminIncidentDateTime,
  getAdminIncidentReasonLabel,
  getAdminIncidentResolutionActionLabel,
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

function getIncidentDisplayCode(incident) {
  return toCleanText(incident?.incidentCode) || toCleanText(incident?.id) || "-";
}

function createIncidentEditForm(incident = {}) {
  return {
    incidentType: toCleanText(incident?.incidentType),
    incidentReason: toCleanText(incident?.incidentReason),
    incidentDescription: toCleanText(incident?.incidentDescription),
    happenedAt: incident?.happenedAt ? createAdminIncidentLocalDateTimeValue(incident.happenedAt) : "",
    status: toCleanText(incident?.status).toUpperCase() || "ACKNOWLEDGED",
    note: toCleanText(incident?.noteText),
    reason: "",
  };
}

function normalizeProductLotRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: toCleanText(row?.id),
      lotNo: toCleanText(row?.lotNo ?? row?.lot_no),
      mfgDate: normalizeDateOnlyInput(row?.mfgDate ?? row?.mfg_date),
      expDate: normalizeDateOnlyInput(row?.expDate ?? row?.exp_date),
      hasWhitelist: Boolean(row?.hasWhitelist ?? row?.has_whitelist),
    }))
    .filter((row) => row.id && row.lotNo && row.expDate)
    .sort((left, right) => {
      if (left.expDate !== right.expDate) return left.expDate.localeCompare(right.expDate);
      return left.lotNo.localeCompare(right.lotNo);
    });
}

function buildLotOptionLabel(lot) {
  const lotNo = toCleanText(lot?.lotNo) || "-";
  const expText = formatDateOnlyDisplay(lot?.expDate) || "-";
  return `${lotNo} (exp ${expText})`;
}

function createLotNormalizeForm(seed = {}) {
  const lotNo = toCleanText(seed?.lotNoSnapshot ?? seed?.lotNo);
  const expDate = normalizeDateOnlyInput(seed?.expDateSnapshot ?? seed?.expDate);
  const mfgDate = normalizeDateOnlyInput(seed?.mfgDateSnapshot ?? seed?.mfgDate);

  return {
    productId: toCleanText(seed?.productId),
    productLabel:
      [toCleanText(seed?.productCodeSnapshot), toCleanText(seed?.productNameSnapshot)]
        .filter(Boolean)
        .join(" : ") || "-",
    sourceLotId: toCleanText(seed?.lotId),
    targetLotId: "",
    targetLotNo: lotNo,
    targetMfgDate: mfgDate,
    targetExpDate: expDate,
    reason: "",
  };
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
  const [isEditingIncident, setIsEditingIncident] = useState(false);
  const [incidentEditForm, setIncidentEditForm] = useState(() => createIncidentEditForm());
  const [isSavingIncidentEdit, setIsSavingIncidentEdit] = useState(false);
  const [isDeletingIncident, setIsDeletingIncident] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isResolveModalOpen, setIsResolveModalOpen] = useState(false);
  const [lotNormalizeForm, setLotNormalizeForm] = useState(() => createLotNormalizeForm());
  const [lotNormalizeOptions, setLotNormalizeOptions] = useState([]);
  const [isLotNormalizeOpen, setIsLotNormalizeOpen] = useState(false);
  const [isLoadingLotNormalizeOptions, setIsLoadingLotNormalizeOptions] = useState(false);
  const [isSavingLotNormalize, setIsSavingLotNormalize] = useState(false);
  const [lotNormalizeError, setLotNormalizeError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");

  const adminLabel = useMemo(
    () => toCleanText(user?.full_name || user?.username || "ADMIN"),
    [user]
  );

  const selectedNormalizeSourceLot = useMemo(
    () => lotNormalizeOptions.find((lot) => lot.id === lotNormalizeForm.sourceLotId) || null,
    [lotNormalizeForm.sourceLotId, lotNormalizeOptions]
  );

  const selectedNormalizeTargetLot = useMemo(
    () => lotNormalizeOptions.find((lot) => lot.id === lotNormalizeForm.targetLotId) || null,
    [lotNormalizeForm.targetLotId, lotNormalizeOptions]
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
          setIsEditingIncident(false);
          setIncidentEditForm(createIncidentEditForm());
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
      setIsEditingIncident(false);
      setIncidentEditForm(createIncidentEditForm());
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
        setIncidentEditForm(createIncidentEditForm(incident || {}));
        setIsEditingIncident(false);
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

  function startIncidentEdit() {
    if (!selectedIncident || selectedIncident?.deletedAt) return;
    setIncidentEditForm(createIncidentEditForm(selectedIncident));
    setDetailError("");
    setIsEditingIncident(true);
  }

  function cancelIncidentEdit() {
    setIncidentEditForm(createIncidentEditForm(selectedIncident || {}));
    setDetailError("");
    setIsEditingIncident(false);
  }

  function setIncidentEditField(field, value) {
    setIncidentEditForm((current) => ({
      ...current,
      [field]: value,
    }));
    setDetailError("");
  }

  async function handleSaveIncidentEdit(event) {
    event.preventDefault();
    if (!selectedIncidentId || isSavingIncidentEdit) return;

    const reason = toCleanText(incidentEditForm.reason);
    if (!reason) {
      setDetailError("กรุณาระบุเหตุผลในการแก้ไข incident เพื่อเก็บ audit");
      return;
    }

    setIsSavingIncidentEdit(true);
    setDetailError("");
    setPageSuccess("");

    try {
      const response = await adminApi.updateIncident(selectedIncidentId, {
        incidentType: incidentEditForm.incidentType,
        incidentReason: incidentEditForm.incidentReason,
        incidentDescription: incidentEditForm.incidentDescription,
        happenedAt: incidentEditForm.happenedAt,
        status: incidentEditForm.status,
        note: incidentEditForm.note,
        reason,
      });
      const incident = response?.incident || null;
      const incidentId = toCleanText(incident?.id);
      setSelectedIncident(incident);
      setStatusDraft(toCleanText(incident?.status).toUpperCase());
      setIncidentEditForm(createIncidentEditForm(incident || {}));
      setIsEditingIncident(false);
      setIncidents((current) =>
        current.map((row) =>
          toCleanText(row?.id) === incidentId
            ? {
                ...row,
                incidentType: incident?.incidentType || row?.incidentType,
                incidentReason: incident?.incidentReason || row?.incidentReason,
                incidentDescription: incident?.incidentDescription || row?.incidentDescription,
                happenedAt: incident?.happenedAt || row?.happenedAt,
                status: incident?.status || row?.status,
                deleteReasonText: incident?.deleteReasonText || row?.deleteReasonText,
                deletedAt: incident?.deletedAt || row?.deletedAt,
              }
            : row
        )
      );
      setPageSuccess(`อัปเดต incident ${getIncidentDisplayCode(incident || {})} สำเร็จ`);
    } catch (error) {
      setDetailError(toCleanText(error?.message) || "แก้ไข incident report ไม่สำเร็จ");
    } finally {
      setIsSavingIncidentEdit(false);
    }
  }

  async function handleDeleteIncident() {
    if (!selectedIncidentId || isDeletingIncident) return;
    if (selectedIncident?.deletedAt) {
      setDetailError("incident นี้ถูกลบ/ซ่อนไปแล้ว");
      return;
    }

    const incidentCode = getIncidentDisplayCode(selectedIncident || {});
    const reason = window.prompt(`ระบุเหตุผลในการลบ incident ${incidentCode}`);
    if (reason === null) return;
    const cleanReason = toCleanText(reason);
    if (!cleanReason) {
      setDetailError("กรุณาระบุเหตุผลก่อนลบ incident เพื่อเก็บ audit");
      return;
    }

    const confirmed = window.confirm(
      `ยืนยันลบ/ซ่อน incident ${incidentCode}?\nrecord จะยังอยู่ในฐานข้อมูลเพื่อ trace stock movements ที่อ้างอิง incident นี้`
    );
    if (!confirmed) return;

    setIsDeletingIncident(true);
    setDetailError("");
    setPageSuccess("");
    try {
      const response = await adminApi.deleteIncident(selectedIncidentId, { reason: cleanReason });
      const incident = response?.incident || selectedIncident;
      const incidentCodeAfterDelete = getIncidentDisplayCode(incident || {});
      setIncidents((current) =>
        current.filter((row) => toCleanText(row?.id) !== toCleanText(selectedIncidentId))
      );
      setSelectedIncidentId("");
      setSelectedIncident(null);
      setStatusDraft("");
      setIncidentEditForm(createIncidentEditForm());
      setIsEditingIncident(false);
      setPageSuccess(`ลบ/ซ่อน incident ${incidentCodeAfterDelete} สำเร็จ`);
    } catch (error) {
      setDetailError(toCleanText(error?.message) || "ลบ incident report ไม่สำเร็จ");
    } finally {
      setIsDeletingIncident(false);
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
      setIncidentEditForm(createIncidentEditForm(incident || {}));
      setIsEditingIncident(false);
    }
  }

  async function handleIncidentResolved(incident) {
    const incidentId = toCleanText(incident?.id);
    setPageSuccess(
      `บันทึก corrective action สำเร็จ (${toCleanText(incident?.incidentCode) || incidentId || "-"})`
    );
    if (incidentId) {
      setSelectedIncidentId(incidentId);
      setSelectedIncident(incident);
      setStatusDraft(toCleanText(incident?.status).toUpperCase());
      setIncidentEditForm(createIncidentEditForm(incident || {}));
      setIsEditingIncident(false);
    }
  }

  function buildResolveSeed(incident) {
    return {
      ...incident,
      resolutionActions: [],
      defaultResolutionActionType:
        toCleanText(incident?.incidentReason).toUpperCase() === "DISPENSE_BEFORE_SMARTCARD"
          ? "RETROSPECTIVE_DISPENSE"
        : "STOCK_OUT",
    };
  }

  async function openLotNormalizeModal(seed) {
    const productId = toCleanText(seed?.productId);
    if (!productId) {
      setDetailError("รายการนี้ไม่มี product id สำหรับจัดการ lot");
      return;
    }

    setLotNormalizeForm(createLotNormalizeForm(seed));
    setLotNormalizeOptions([]);
    setLotNormalizeError("");
    setIsLotNormalizeOpen(true);
    setIsLoadingLotNormalizeOptions(true);

    try {
      const payload = await productsApi.lotWhitelists(productId);
      const lots = normalizeProductLotRows(payload?.lots);
      setLotNormalizeOptions(lots);
      setLotNormalizeForm((current) => {
        const sourceLotId =
          current.sourceLotId && lots.some((lot) => lot.id === current.sourceLotId)
            ? current.sourceLotId
            : lots.find(
                (lot) =>
                  lot.lotNo === toCleanText(seed?.lotNoSnapshot) &&
                  lot.expDate === normalizeDateOnlyInput(seed?.expDateSnapshot)
              )?.id || current.sourceLotId;
        const sourceLot = lots.find((lot) => lot.id === sourceLotId);

        return {
          ...current,
          sourceLotId,
          targetLotNo: current.targetLotNo || sourceLot?.lotNo || "",
          targetMfgDate: current.targetMfgDate || sourceLot?.mfgDate || "",
          targetExpDate: current.targetExpDate || sourceLot?.expDate || "",
        };
      });
    } catch (error) {
      setLotNormalizeError(toCleanText(error?.message) || "โหลดรายการ lot ของสินค้าไม่สำเร็จ");
    } finally {
      setIsLoadingLotNormalizeOptions(false);
    }
  }

  function closeLotNormalizeModal({ force = false } = {}) {
    if (isSavingLotNormalize && !force) return;
    setIsLotNormalizeOpen(false);
    setLotNormalizeError("");
    setLotNormalizeOptions([]);
    setLotNormalizeForm(createLotNormalizeForm());
  }

  function setLotNormalizeField(field, value) {
    setLotNormalizeForm((current) => ({
      ...current,
      [field]: value,
    }));
    setLotNormalizeError("");
  }

  function handleLotNormalizeSourceChange(lotId) {
    const lot = lotNormalizeOptions.find((option) => option.id === lotId);
    setLotNormalizeForm((current) => ({
      ...current,
      sourceLotId: lotId,
      targetLotId: current.targetLotId === lotId ? "" : current.targetLotId,
      targetLotNo: lot?.lotNo || current.targetLotNo,
      targetMfgDate: lot?.mfgDate || "",
      targetExpDate: lot?.expDate || current.targetExpDate,
    }));
    setLotNormalizeError("");
  }

  function handleLotNormalizeTargetChange(lotId) {
    const lot = lotNormalizeOptions.find((option) => option.id === lotId);
    setLotNormalizeForm((current) => ({
      ...current,
      targetLotId: lotId,
      targetLotNo: lot?.lotNo || current.targetLotNo,
      targetMfgDate: lot?.mfgDate || "",
      targetExpDate: lot?.expDate || current.targetExpDate,
    }));
    setLotNormalizeError("");
  }

  async function handleSubmitLotNormalize(event) {
    event.preventDefault();
    if (isSavingLotNormalize) return;

    const productId = toCleanText(lotNormalizeForm.productId);
    const sourceLotId = toCleanText(lotNormalizeForm.sourceLotId);
    const targetLotNo = toCleanText(lotNormalizeForm.targetLotNo);
    const targetExpDate = normalizeDateOnlyInput(lotNormalizeForm.targetExpDate);
    const reason = toCleanText(lotNormalizeForm.reason);

    if (!productId || !sourceLotId) {
      setLotNormalizeError("กรุณาเลือกสินค้าและ lot ต้นทาง");
      return;
    }
    if (!targetLotNo || !targetExpDate) {
      setLotNormalizeError("กรุณาระบุเลข lot และวันหมดอายุปลายทาง");
      return;
    }
    if (!reason) {
      setLotNormalizeError("กรุณาระบุเหตุผลก่อน normalize lot");
      return;
    }

    const sourceLabel = buildLotOptionLabel(selectedNormalizeSourceLot);
    const targetLabel = selectedNormalizeTargetLot
      ? buildLotOptionLabel(selectedNormalizeTargetLot)
      : `${targetLotNo} (exp ${formatDateOnlyDisplay(targetExpDate) || targetExpDate})`;
    const confirmed = window.confirm(
      `ยืนยัน normalize lot?\nจาก: ${sourceLabel}\nไปเป็น: ${targetLabel}\n\nถ้า lot ปลายทางมีอยู่แล้ว ระบบจะ merge stock/movement ทั้งหมดเข้าหา lot ปลายทาง`
    );
    if (!confirmed) return;

    setIsSavingLotNormalize(true);
    setLotNormalizeError("");
    setPageSuccess("");

    try {
      const response = await productsApi.normalizeLot(productId, {
        sourceLotId,
        targetLotId: toCleanText(lotNormalizeForm.targetLotId) || undefined,
        targetLotNo,
        targetMfgDate: normalizeDateOnlyInput(lotNormalizeForm.targetMfgDate) || undefined,
        targetExpDate,
        reason,
      });
      const operation = toCleanText(response?.operation);
      const targetLot = response?.targetLot || {};
      setPageSuccess(
        operation === "MERGE"
          ? `Merge lot สำเร็จ: ${sourceLabel} -> ${buildLotOptionLabel(targetLot)}`
          : `แก้เลข lot สำเร็จ: ${buildLotOptionLabel(targetLot)}`
      );
      closeLotNormalizeModal({ force: true });
      if (selectedIncidentId) {
        const detailResponse = await adminApi.getIncident(selectedIncidentId);
        const incident = detailResponse?.incident || null;
        setSelectedIncident(incident);
        setStatusDraft(toCleanText(incident?.status).toUpperCase());
        setIncidentEditForm(createIncidentEditForm(incident || {}));
      }
    } catch (error) {
      setLotNormalizeError(toCleanText(error?.message) || "normalize lot ไม่สำเร็จ");
    } finally {
      setIsSavingLotNormalize(false);
    }
  }

  return (
    <section className="admin-incident-page">
      <header className="admin-incident-page__header">
        <div>
          <p className="admin-incident-page__eyebrow">Admin Governance</p>
          <h1>Incident Reports</h1>
          <p>
            ระบบนี้ใช้เก็บเหตุผิดปกติสำหรับ audit และการตามงานย้อนหลัง
            และสามารถผูก corrective actions แบบ stock correction หรือ retrospective dispense
            กลับเข้ากับ incident เดียวกันได้
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
              <p>ดู metadata, item snapshots, corrective actions และอัปเดตสถานะของ incident</p>
            </div>
            {selectedIncident ? (
              <div className="admin-incident-page__detail-actions">
                <button
                  type="button"
                  className="admin-incident-page__secondary"
                  onClick={startIncidentEdit}
                  disabled={
                    isEditingIncident ||
                    isSavingIncidentEdit ||
                    isDeletingIncident ||
                    Boolean(selectedIncident?.deletedAt)
                  }
                >
                  แก้ไข
                </button>
                <button
                  type="button"
                  className="admin-incident-page__danger"
                  onClick={() => void handleDeleteIncident()}
                  disabled={isSavingIncidentEdit || isDeletingIncident || Boolean(selectedIncident?.deletedAt)}
                >
                  {isDeletingIncident ? "กำลังลบ..." : "ลบ"}
                </button>
              </div>
            ) : null}
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

              {selectedIncident?.deletedAt ? (
                <section className="admin-incident-page__deleted-block">
                  <strong>incident นี้ถูกลบ/ซ่อนแล้ว</strong>
                  <span>
                    ลบโดย{" "}
                    {toCleanText(selectedIncident?.deletedByAdminName) ||
                      toCleanText(selectedIncident?.deletedByAdminUsername) ||
                      "-"}{" "}
                    เมื่อ {formatAdminIncidentDateTime(selectedIncident?.deletedAt)}
                  </span>
                  <span>เหตุผล: {toCleanText(selectedIncident?.deleteReasonText) || "-"}</span>
                </section>
              ) : null}

              {isEditingIncident ? (
                <section className="admin-incident-page__detail-block admin-incident-page__edit-panel">
                  <div className="admin-incident-page__detail-block-header">
                    <h3>Edit incident metadata</h3>
                    <button
                      type="button"
                      className="admin-incident-page__secondary"
                      onClick={cancelIncidentEdit}
                      disabled={isSavingIncidentEdit}
                    >
                      ยกเลิก
                    </button>
                  </div>
                  <form className="admin-incident-page__edit-form" onSubmit={handleSaveIncidentEdit}>
                    <div className="admin-incident-page__edit-grid">
                      <label>
                        <span>Incident type</span>
                        <select
                          value={incidentEditForm.incidentType}
                          onChange={(event) => setIncidentEditField("incidentType", event.target.value)}
                          required
                        >
                          {ADMIN_INCIDENT_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <span>Incident reason</span>
                        <select
                          value={incidentEditForm.incidentReason}
                          onChange={(event) => setIncidentEditField("incidentReason", event.target.value)}
                          required
                        >
                          {ADMIN_INCIDENT_REASON_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <span>Status</span>
                        <select
                          value={incidentEditForm.status}
                          onChange={(event) => setIncidentEditField("status", event.target.value)}
                          required
                        >
                          {ADMIN_INCIDENT_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <span>Happened at</span>
                        <input
                          type="datetime-local"
                          value={incidentEditForm.happenedAt}
                          onChange={(event) => setIncidentEditField("happenedAt", event.target.value)}
                          required
                        />
                      </label>
                    </div>

                    <label>
                      <span>Description</span>
                      <textarea
                        value={incidentEditForm.incidentDescription}
                        onChange={(event) =>
                          setIncidentEditField("incidentDescription", event.target.value)
                        }
                        rows={4}
                        required
                      />
                    </label>

                    <label>
                      <span>Note / reference</span>
                      <textarea
                        value={incidentEditForm.note}
                        onChange={(event) => setIncidentEditField("note", event.target.value)}
                        rows={3}
                      />
                    </label>

                    <label>
                      <span>เหตุผลในการแก้ไข</span>
                      <textarea
                        value={incidentEditForm.reason}
                        onChange={(event) => setIncidentEditField("reason", event.target.value)}
                        placeholder="ระบุเหตุผลเพื่อเก็บใน audit metadata"
                        rows={3}
                        required
                      />
                    </label>

                    <div className="admin-incident-page__status-editor">
                      <button
                        type="button"
                        className="admin-incident-page__secondary"
                        onClick={cancelIncidentEdit}
                        disabled={isSavingIncidentEdit}
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="submit"
                        className="admin-incident-page__primary"
                        disabled={isSavingIncidentEdit}
                      >
                        {isSavingIncidentEdit ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
                      </button>
                    </div>
                  </form>
                </section>
              ) : null}

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
                  <button
                    type="button"
                    className="admin-incident-page__secondary"
                    onClick={() => setIsResolveModalOpen(true)}
                  >
                    ทำ corrective action
                  </button>
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

              <section className="admin-incident-page__detail-block admin-incident-page__detail-block--items">
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
                          <th>Lot tools</th>
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
                            <td>
                              <button
                                type="button"
                                className="admin-incident-page__secondary admin-incident-page__lot-tool"
                                onClick={() => void openLotNormalizeModal(item)}
                                disabled={!toCleanText(item?.productId) || Boolean(selectedIncident?.deletedAt)}
                              >
                                Normalize lot
                              </button>
                            </td>
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

              <section className="admin-incident-page__detail-block admin-incident-page__detail-block--resolution">
                <h3>Resolution actions</h3>
                {Array.isArray(selectedIncident?.resolutionActions) &&
                selectedIncident.resolutionActions.length ? (
                  <div className="admin-incident-page__table-wrap">
                    <table className="admin-incident-page__table admin-incident-page__table--detail">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Action</th>
                          <th>Product</th>
                          <th>Lot snapshot</th>
                          <th>Qty</th>
                          <th>Unit</th>
                          <th>Applied</th>
                          <th>Reference</th>
                          <th>Lot tools</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedIncident.resolutionActions.map((action) => (
                          <tr key={toCleanText(action?.id) || action?.lineNo}>
                            <td>{Number(action?.lineNo || 0)}</td>
                            <td>{getAdminIncidentResolutionActionLabel(action?.actionType)}</td>
                            <td>
                              <div className="admin-incident-page__product-cell">
                                <strong>{toCleanText(action?.productNameSnapshot) || "-"}</strong>
                                <span>{toCleanText(action?.productCodeSnapshot) || "-"}</span>
                              </div>
                            </td>
                            <td>
                              <div className="admin-incident-page__product-cell">
                                <strong>{toCleanText(action?.lotNoSnapshot) || "-"}</strong>
                                <span>{toCleanText(action?.expDateSnapshot) || "-"}</span>
                              </div>
                            </td>
                            <td>{Number(action?.qty || 0)}</td>
                            <td>{toCleanText(action?.unitLabelSnapshot) || "-"}</td>
                            <td>{formatAdminIncidentDateTime(action?.appliedAt)}</td>
                            <td>
                              <div className="admin-incident-page__product-cell">
                                <strong>{toCleanText(action?.appliedStockMovementId) || "-"}</strong>
                                <span>
                                  {[
                                    toCleanText(action?.appliedDispenseHeaderId)
                                      ? `dispenseHeader=${toCleanText(action?.appliedDispenseHeaderId)}`
                                      : "",
                                    toCleanText(action?.appliedDispenseLineId)
                                      ? `dispenseLine=${toCleanText(action?.appliedDispenseLineId)}`
                                      : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" / ") || "-"}
                                </span>
                                <span>
                                  {toCleanText(action?.patientFullNameSnapshot)
                                    ? `${toCleanText(action?.patientFullNameSnapshot)} (${toCleanText(
                                        action?.patientPidSnapshot
                                      ) || "-"})`
                                    : toCleanText(action?.noteText) || "-"}
                                </span>
                              </div>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="admin-incident-page__secondary admin-incident-page__lot-tool"
                                onClick={() => void openLotNormalizeModal(action)}
                                disabled={!toCleanText(action?.productId) || Boolean(selectedIncident?.deletedAt)}
                              >
                                Normalize lot
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="admin-incident-page__state admin-incident-page__state--compact">
                    incident นี้ยังไม่มี corrective actions ที่ apply แล้ว
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="admin-incident-page__state">ไม่พบรายละเอียด incident ที่เลือก</div>
          )}
        </aside>
      </div>

      {isLotNormalizeOpen ? (
        <div
          className="admin-incident-page__modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-lot-normalize-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeLotNormalizeModal();
            }
          }}
        >
          <div className="admin-incident-page__lot-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-incident-page__lot-modal-header">
              <div>
                <h2 id="admin-lot-normalize-title">Normalize product lot</h2>
                <p>
                  ใช้สำหรับแก้เลข lot ที่พิมพ์ผิด หรือ merge lot ผิดเข้าหา lot ที่ถูกใน stock/movement ledger
                </p>
              </div>
              <button
                type="button"
                className="admin-incident-page__secondary"
                onClick={() => closeLotNormalizeModal()}
                disabled={isSavingLotNormalize}
              >
                ปิด
              </button>
            </div>

            <form className="admin-incident-page__lot-form" onSubmit={handleSubmitLotNormalize}>
              <div className="admin-incident-page__lot-product">
                <span>Product</span>
                <strong>{lotNormalizeForm.productLabel}</strong>
              </div>

              <label>
                <span>Lot ต้นทางที่พิมพ์ผิด</span>
                <select
                  value={lotNormalizeForm.sourceLotId}
                  onChange={(event) => handleLotNormalizeSourceChange(event.target.value)}
                  disabled={isLoadingLotNormalizeOptions || isSavingLotNormalize}
                >
                  <option value="">เลือก lot ต้นทาง</option>
                  {lotNormalizeOptions.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {buildLotOptionLabel(lot)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Lot ปลายทางที่มีอยู่แล้ว (ถ้าต้อง merge)</span>
                <select
                  value={lotNormalizeForm.targetLotId}
                  onChange={(event) => handleLotNormalizeTargetChange(event.target.value)}
                  disabled={isLoadingLotNormalizeOptions || isSavingLotNormalize}
                >
                  <option value="">ไม่มี / แก้ lot ต้นทางเป็นเลขใหม่ด้านล่าง</option>
                  {lotNormalizeOptions
                    .filter((lot) => lot.id !== lotNormalizeForm.sourceLotId)
                    .map((lot) => (
                      <option key={lot.id} value={lot.id}>
                        {buildLotOptionLabel(lot)}
                      </option>
                    ))}
                </select>
              </label>

              <div className="admin-incident-page__lot-grid">
                <label>
                  <span>เลข lot ที่ถูกต้อง</span>
                  <input
                    type="text"
                    value={lotNormalizeForm.targetLotNo}
                    onChange={(event) => setLotNormalizeField("targetLotNo", event.target.value)}
                    disabled={isSavingLotNormalize}
                    placeholder="เช่น 26A16G1"
                  />
                </label>
                <label>
                  <span>วันหมดอายุ</span>
                  <input
                    type="date"
                    value={lotNormalizeForm.targetExpDate}
                    onChange={(event) => setLotNormalizeField("targetExpDate", event.target.value)}
                    disabled={isSavingLotNormalize}
                  />
                </label>
                <label>
                  <span>วันผลิต (ถ้ามี)</span>
                  <input
                    type="date"
                    value={lotNormalizeForm.targetMfgDate}
                    onChange={(event) => setLotNormalizeField("targetMfgDate", event.target.value)}
                    disabled={isSavingLotNormalize}
                  />
                </label>
              </div>

              <label>
                <span>เหตุผล / incident note</span>
                <textarea
                  rows={3}
                  value={lotNormalizeForm.reason}
                  onChange={(event) => setLotNormalizeField("reason", event.target.value)}
                  disabled={isSavingLotNormalize}
                  placeholder="เช่น normalize lot 26A1661 เป็น 26A16G1 จากการตรวจสอบฉลากจริง"
                />
              </label>

              {isLoadingLotNormalizeOptions ? (
                <div className="admin-incident-page__state admin-incident-page__state--compact">
                  กำลังโหลด lot ของสินค้า...
                </div>
              ) : null}
              {lotNormalizeError ? (
                <div className="admin-incident-page__feedback admin-incident-page__feedback--error">
                  {lotNormalizeError}
                </div>
              ) : null}

              <div className="admin-incident-page__lot-actions">
                <button
                  type="submit"
                  className="admin-incident-page__primary"
                  disabled={
                    isLoadingLotNormalizeOptions ||
                    isSavingLotNormalize ||
                    !lotNormalizeForm.sourceLotId ||
                    !toCleanText(lotNormalizeForm.targetLotNo) ||
                    !normalizeDateOnlyInput(lotNormalizeForm.targetExpDate)
                  }
                >
                  {isSavingLotNormalize ? "กำลัง normalize..." : "Normalize lot"}
                </button>
                <button
                  type="button"
                  className="admin-incident-page__secondary"
                  onClick={() => closeLotNormalizeModal()}
                  disabled={isSavingLotNormalize}
                >
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <AdminIncidentModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={(incident) => void handleIncidentCreated(incident)}
      />

      <AdminIncidentModal
        open={isResolveModalOpen}
        mode="resolve"
        incidentId={selectedIncidentId}
        title="ทำ Corrective Action จาก Incident"
        initialValues={buildResolveSeed(selectedIncident || {})}
        onClose={() => setIsResolveModalOpen(false)}
        onResolved={(incident) => {
          setIsResolveModalOpen(false);
          void handleIncidentResolved(incident);
        }}
      />
    </section>
  );
}
