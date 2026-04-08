import { useEffect, useMemo, useRef, useState } from "react";
import { adminApi, inventoryApi, productsApi } from "../lib/api";
import {
  ADMIN_INCIDENT_REASON_OPTIONS,
  ADMIN_INCIDENT_RESOLUTION_ACTION_OPTIONS,
  ADMIN_INCIDENT_STATUS_OPTIONS,
  ADMIN_INCIDENT_TYPE_OPTIONS,
  createAdminIncidentLocalDateTimeValue,
  formatAdminIncidentDateTime,
} from "../lib/adminIncidents";
import "./AdminIncidentModal.css";

function toCleanText(value) {
  return String(value ?? "").trim();
}

function createRowKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProducts(list) {
  return (Array.isArray(list) ? list : [])
    .map((row) => ({
      id: toCleanText(row?.id),
      productCode: toCleanText(row?.productCode ?? row?.product_code),
      tradeName: toCleanText(row?.tradeName ?? row?.trade_name ?? row?.productName),
    }))
    .filter((row) => row.id && row.tradeName)
    .sort((left, right) => {
      const leftLabel = `${left.productCode} ${left.tradeName}`.trim();
      const rightLabel = `${right.productCode} ${right.tradeName}`.trim();
      return leftLabel.localeCompare(rightLabel);
    });
}

function normalizeLots(list) {
  return (Array.isArray(list) ? list : [])
    .map((row) => ({
      id: toCleanText(row?.id ?? row?.lotId ?? row?.lot_id),
      lotNo: toCleanText(row?.lotNo ?? row?.lot_no),
      expDate: toCleanText(row?.expDate ?? row?.exp_date),
    }))
    .filter((row) => row.id && row.lotNo);
}

function normalizeUnitOptions(response) {
  const rows = Array.isArray(response?.items) ? response.items : [];
  return rows
    .map((row) => ({
      id: toCleanText(row?.id),
      displayName: toCleanText(row?.displayName ?? row?.display_name ?? row?.code),
      code: toCleanText(row?.code),
      isSellable: Boolean(row?.isSellable ?? row?.is_sellable),
      isBase: Boolean(row?.isBase ?? row?.is_base),
      sortOrder: Number(row?.sortOrder ?? row?.sort_order ?? 0),
    }))
    .filter((row) => row.id && row.displayName)
    .sort((left, right) => {
      if (left.isSellable !== right.isSellable) return Number(right.isSellable) - Number(left.isSellable);
      if (left.isBase !== right.isBase) return Number(right.isBase) - Number(left.isBase);
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.displayName.localeCompare(right.displayName);
    });
}

function chooseUnitOption(options, row, defaultUnitLevelId = "") {
  const preferredUnitLevelId = toCleanText(row?.unitLevelId ?? row?.unit_level_id);
  const preferredUnitLabel = toCleanText(
    row?.unitLabel ??
      row?.unit_label ??
      row?.unitLabelSnapshot ??
      row?.unit_label_snapshot
  );

  return (
    options.find((option) => option.id === preferredUnitLevelId) ||
    options.find((option) => option.displayName === preferredUnitLabel) ||
    options.find((option) => option.id === defaultUnitLevelId) ||
    options[0] ||
    null
  );
}

function buildDefaultResolutionActionType(initialValues = {}) {
  const explicit = toCleanText(initialValues?.defaultResolutionActionType).toUpperCase();
  if (explicit) {
    return explicit;
  }

  const seededPatient =
    initialValues?.resolutionPatient ??
    initialValues?.resolution_patient ??
    initialValues?.patient ??
    {};
  const hasPatientIdentity =
    Boolean(toCleanText(seededPatient?.pid)) &&
    Boolean(toCleanText(seededPatient?.fullName ?? seededPatient?.full_name ?? seededPatient?.name));

  if (hasPatientIdentity) {
    return "RETROSPECTIVE_DISPENSE";
  }

  const incidentReason = toCleanText(initialValues?.incidentReason ?? initialValues?.incident_reason).toUpperCase();
  if (incidentReason === "DISPENSE_BEFORE_SMARTCARD") {
    return "RETROSPECTIVE_DISPENSE";
  }

  return "STOCK_OUT";
}

function createEmptyIncidentItem(seed = {}) {
  return {
    key: createRowKey("incident-item"),
    productId: toCleanText(seed?.productId ?? seed?.product_id),
    lotId: toCleanText(seed?.lotId ?? seed?.lot_id),
    qty: toCleanText(seed?.qty ?? "1"),
    unitLevelId: toCleanText(seed?.unitLevelId ?? seed?.unit_level_id),
    unitLabel: toCleanText(
      seed?.unitLabel ??
        seed?.unit_label ??
        seed?.unitLabelSnapshot ??
        seed?.unit_label_snapshot
    ),
    lotNoSnapshot: toCleanText(seed?.lotNoSnapshot ?? seed?.lot_no_snapshot ?? seed?.lotNo ?? seed?.lot_no),
    expDateSnapshot: toCleanText(seed?.expDateSnapshot ?? seed?.exp_date_snapshot),
    note: toCleanText(seed?.note ?? seed?.noteText ?? seed?.note_text),
    lotOptions: [],
    unitOptions: [],
    isLoadingLots: false,
    isLoadingUnits: false,
  };
}

function createEmptyResolutionAction(seed = {}, defaultActionType = "STOCK_OUT") {
  return {
    key: createRowKey("incident-resolution"),
    actionType: toCleanText(seed?.actionType ?? seed?.action_type).toUpperCase() || defaultActionType,
    productId: toCleanText(seed?.productId ?? seed?.product_id),
    lotId: toCleanText(seed?.lotId ?? seed?.lot_id),
    qty: toCleanText(seed?.qty ?? "1"),
    unitLevelId: toCleanText(seed?.unitLevelId ?? seed?.unit_level_id),
    unitLabel: toCleanText(
      seed?.unitLabel ??
        seed?.unit_label ??
        seed?.unitLabelSnapshot ??
        seed?.unit_label_snapshot
    ),
    lotNoSnapshot: toCleanText(seed?.lotNoSnapshot ?? seed?.lot_no_snapshot ?? seed?.lotNo ?? seed?.lot_no),
    expDateSnapshot: toCleanText(seed?.expDateSnapshot ?? seed?.exp_date_snapshot),
    note: toCleanText(seed?.note ?? seed?.noteText ?? seed?.note_text),
    lotOptions: [],
    unitOptions: [],
    isLoadingLots: false,
    isLoadingUnits: false,
  };
}

function createEmptyResolutionPatient(seed = {}) {
  return {
    pid: toCleanText(seed?.pid),
    fullName: toCleanText(seed?.fullName ?? seed?.full_name ?? seed?.name),
    englishName: toCleanText(seed?.englishName ?? seed?.english_name),
    birthDate: toCleanText(seed?.birthDate ?? seed?.birth_date),
    sex: toCleanText(seed?.sex),
    cardIssuePlace: toCleanText(seed?.cardIssuePlace ?? seed?.card_issue_place),
    cardIssuedDate: toCleanText(seed?.cardIssuedDate ?? seed?.card_issued_date),
    cardExpiryDate: toCleanText(seed?.cardExpiryDate ?? seed?.card_expiry_date),
    addressText: toCleanText(seed?.addressText ?? seed?.address_text ?? seed?.address_raw_text),
  };
}

function createInitialFormState(initialValues = {}, mode = "create") {
  const seededItems = Array.isArray(initialValues?.items) ? initialValues.items : [];
  const seededResolutionActions = Array.isArray(initialValues?.resolutionActions ?? initialValues?.resolution_actions)
    ? initialValues.resolutionActions ?? initialValues.resolution_actions
    : [];
  const defaultActionType = buildDefaultResolutionActionType(initialValues);
  const resolutionSeed =
    seededResolutionActions.length
      ? seededResolutionActions
      : mode === "resolve" && seededItems.length
      ? seededItems.map((item) => ({
          productId: item?.productId ?? item?.product_id,
          lotId: item?.lotId ?? item?.lot_id,
          qty: item?.qty ?? 1,
          unitLevelId: item?.unitLevelId ?? item?.unit_level_id,
          unitLabel: item?.unitLabelSnapshot ?? item?.unit_label_snapshot ?? item?.unitLabel ?? item?.unit_label,
          lotNoSnapshot: item?.lotNoSnapshot ?? item?.lot_no_snapshot,
          expDateSnapshot: item?.expDateSnapshot ?? item?.exp_date_snapshot,
          note: item?.noteText ?? item?.note_text ?? item?.note,
          actionType: defaultActionType,
        }))
      : [];

  return {
    incidentType: toCleanText(initialValues?.incidentType ?? initialValues?.incident_type) || "SMARTCARD_EXCEPTION",
    incidentReason:
      toCleanText(initialValues?.incidentReason ?? initialValues?.incident_reason) ||
      "DISPENSE_BEFORE_SMARTCARD",
    branchCode: toCleanText(initialValues?.branchCode ?? initialValues?.branch_code),
    happenedAt: createAdminIncidentLocalDateTimeValue(
      initialValues?.happenedAt ?? initialValues?.happened_at ?? new Date()
    ),
    status: toCleanText(initialValues?.status).toUpperCase() || "ACKNOWLEDGED",
    incidentDescription:
      toCleanText(initialValues?.incidentDescription ?? initialValues?.incident_description),
    note: toCleanText(initialValues?.note ?? initialValues?.noteText ?? initialValues?.note_text),
    smartcardSessionId: toCleanText(
      initialValues?.smartcardSessionId ?? initialValues?.smartcard_session_id
    ),
    dispenseAttemptId: toCleanText(
      initialValues?.dispenseAttemptId ?? initialValues?.dispense_attempt_id
    ),
    items: seededItems.length ? seededItems.map((item) => createEmptyIncidentItem(item)) : [],
    resolutionActions: resolutionSeed.length
      ? resolutionSeed.map((row) => createEmptyResolutionAction(row, defaultActionType))
      : [],
    resolutionPatient: createEmptyResolutionPatient(
      initialValues?.resolutionPatient ??
        initialValues?.resolution_patient ??
        initialValues?.patient ??
        {}
    ),
  };
}

function hasAnyIncidentItemValue(row) {
  return Boolean(
    toCleanText(row?.productId) ||
      toCleanText(row?.lotId) ||
      toCleanText(row?.qty) ||
      toCleanText(row?.unitLevelId) ||
      toCleanText(row?.unitLabel) ||
      toCleanText(row?.lotNoSnapshot) ||
      toCleanText(row?.expDateSnapshot) ||
      toCleanText(row?.note)
  );
}

function hasAnyResolutionActionValue(row) {
  return Boolean(
    toCleanText(row?.actionType) ||
      toCleanText(row?.productId) ||
      toCleanText(row?.lotId) ||
      toCleanText(row?.qty) ||
      toCleanText(row?.unitLevelId) ||
      toCleanText(row?.unitLabel) ||
      toCleanText(row?.lotNoSnapshot) ||
      toCleanText(row?.expDateSnapshot) ||
      toCleanText(row?.note)
  );
}

function shouldShowResolutionPatientSection(actions = [], patient = {}) {
  const hasRetrospectiveAction = actions.some(
    (row) => toCleanText(row?.actionType).toUpperCase() === "RETROSPECTIVE_DISPENSE"
  );
  const hasSeededPatient = Object.values(createEmptyResolutionPatient(patient)).some(Boolean);
  return hasRetrospectiveAction || hasSeededPatient;
}

function getBranchDisplay(branch) {
  const code = toCleanText(branch?.code);
  const name = toCleanText(branch?.name);
  if (code && name) return `${code} : ${name}`;
  return code || name || "-";
}

function getLotDisplay(lot) {
  if (!lot) return "-";
  return lot.expDate ? `${lot.lotNo} (exp ${lot.expDate})` : lot.lotNo;
}

function getProductDisplay(product) {
  if (!product) return "-";
  return product.productCode ? `${product.productCode} : ${product.tradeName}` : product.tradeName;
}

function ResolutionSummary({ initialValues, mode }) {
  const incidentCode = toCleanText(initialValues?.incidentCode);
  const branchCode = toCleanText(initialValues?.branchCode ?? initialValues?.branch_code);
  const branchName = toCleanText(initialValues?.branchName ?? initialValues?.branch_name);
  const happenedAt = initialValues?.happenedAt ?? initialValues?.happened_at;
  const description = toCleanText(initialValues?.incidentDescription ?? initialValues?.incident_description);

  if (mode !== "resolve") return null;

  return (
    <section className="admin-incident-modal__summary">
      <div className="admin-incident-modal__summary-grid">
        <div>
          <strong>Incident code</strong>
          <span>{incidentCode || "-"}</span>
        </div>
        <div>
          <strong>Branch</strong>
          <span>{branchCode ? `${branchCode}${branchName ? ` : ${branchName}` : ""}` : "-"}</span>
        </div>
        <div>
          <strong>Happened at</strong>
          <span>{formatAdminIncidentDateTime(happenedAt)}</span>
        </div>
        <div>
          <strong>Mode</strong>
          <span>เพิ่ม corrective action ให้ incident เดิม</span>
        </div>
      </div>
      <p className="admin-incident-modal__summary-note">
        {description || "ระบบจะสร้าง correction เพิ่มเติมโดย trace กลับไปที่ incident เดิม"}
      </p>
    </section>
  );
}

function ProductRowCard({
  row,
  index,
  productOptions,
  productMap,
  disabled,
  title,
  onRemove,
  onProductChange,
  onLotChange,
  onUnitChange,
  onFieldChange,
  children,
}) {
  const selectedProduct = productMap.get(row.productId);

  return (
    <div className="admin-incident-modal__item-card">
      <div className="admin-incident-modal__item-card-header">
        <strong>
          {title} {index + 1}
        </strong>
        <button type="button" className="admin-incident-modal__remove" onClick={onRemove} disabled={disabled}>
          ลบ
        </button>
      </div>

      <div className="admin-incident-modal__item-grid">
        {children}

        <label className="admin-incident-modal__field">
          <span>Product</span>
          <select
            value={row.productId}
            onChange={(event) => void onProductChange(event.target.value)}
            disabled={disabled}
          >
            <option value="">เลือกสินค้า</option>
            {productOptions.map((product) => (
              <option key={product.id} value={product.id}>
                {getProductDisplay(product)}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-incident-modal__field">
          <span>Lot</span>
          <select
            value={row.lotId}
            onChange={(event) => void onLotChange(event.target.value)}
            disabled={!row.productId || row.isLoadingLots || disabled}
          >
            <option value="">
              {!row.productId
                ? "เลือกสินค้าก่อน"
                : row.isLoadingLots
                ? "กำลังโหลด lot..."
                : row.lotOptions.length
                ? "เลือก lot"
                : "ไม่พบ lot ในระบบ"}
            </option>
            {row.lotOptions.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {getLotDisplay(lot)}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-incident-modal__field">
          <span>Qty</span>
          <input
            type="number"
            min="0.001"
            step="0.001"
            value={row.qty}
            onChange={(event) => onFieldChange("qty", event.target.value)}
            disabled={disabled}
            placeholder="0"
          />
        </label>

        <label className="admin-incident-modal__field">
          <span>Unit</span>
          <select
            value={row.unitLevelId}
            onChange={(event) => onUnitChange(event.target.value)}
            disabled={!row.productId || row.isLoadingUnits || disabled}
          >
            <option value="">
              {!row.productId
                ? "เลือกสินค้าก่อน"
                : row.isLoadingUnits
                ? "กำลังโหลดหน่วย..."
                : row.unitOptions.length
                ? "เลือกหน่วย"
                : "ไม่พบหน่วยที่ใช้ได้"}
            </option>
            {row.unitOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-incident-modal__field">
          <span>Lot no snapshot</span>
          <input
            type="text"
            value={row.lotNoSnapshot}
            onChange={(event) => onFieldChange("lotNoSnapshot", event.target.value)}
            disabled={disabled}
            placeholder="เลข lot ที่เห็นในเหตุการณ์"
          />
        </label>

        <label className="admin-incident-modal__field">
          <span>EXP snapshot</span>
          <input
            type="date"
            value={row.expDateSnapshot}
            onChange={(event) => onFieldChange("expDateSnapshot", event.target.value)}
            disabled={disabled}
          />
        </label>

        <label className="admin-incident-modal__field admin-incident-modal__field--full">
          <span>Note</span>
          <textarea
            rows={2}
            value={row.note}
            onChange={(event) => onFieldChange("note", event.target.value)}
            disabled={disabled}
            placeholder="คำอธิบายเฉพาะแถวนี้"
          />
        </label>
      </div>

      {selectedProduct ? (
        <div className="admin-incident-modal__item-summary">
          <span>สินค้า: {selectedProduct.tradeName}</span>
          <span>รหัส: {selectedProduct.productCode || "-"}</span>
          <span>lot snapshot: {row.lotNoSnapshot || "-"}</span>
          <span>unit snapshot: {row.unitLabel || "-"}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminIncidentModal({
  open,
  onClose,
  onCreated,
  onResolved,
  initialValues,
  title = "สร้าง Incident Report",
  mode = "create",
  incidentId = "",
}) {
  const lotCacheRef = useRef(new Map());
  const unitCacheRef = useRef(new Map());
  const [form, setForm] = useState(() => createInitialFormState(initialValues, mode));
  const [branches, setBranches] = useState([]);
  const [products, setProducts] = useState([]);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const productOptions = useMemo(() => normalizeProducts(products), [products]);
  const productMap = useMemo(
    () => new Map(productOptions.map((product) => [product.id, product])),
    [productOptions]
  );
  const branchOptions = useMemo(
    () =>
      (Array.isArray(branches) ? branches : []).map((branch) => ({
        id: toCleanText(branch?.id),
        code: toCleanText(branch?.code),
        name: toCleanText(branch?.name),
      })),
    [branches]
  );
  const showResolutionPatient = useMemo(
    () => shouldShowResolutionPatientSection(form.resolutionActions, form.resolutionPatient),
    [form.resolutionActions, form.resolutionPatient]
  );

  useEffect(() => {
    if (!open) return;

    let isCancelled = false;
    const nextForm = createInitialFormState(initialValues, mode);
    setForm(nextForm);
    setError("");

    async function loadLots(productId) {
      const key = toCleanText(productId);
      if (!key) return [];
      const cached = lotCacheRef.current.get(key);
      if (cached) return cached;

      const response = await productsApi.lotWhitelists(key);
      const lots = normalizeLots(response?.lots);
      lotCacheRef.current.set(key, lots);
      return lots;
    }

    async function loadUnits(productId, lotContext = {}) {
      const normalizedProductId = toCleanText(productId);
      const normalizedLotId = toCleanText(lotContext?.lotId);
      const normalizedLotNo = toCleanText(lotContext?.lotNoSnapshot ?? lotContext?.lotNo);
      const normalizedExpDate = toCleanText(lotContext?.expDateSnapshot ?? lotContext?.expDate);
      const cacheKey = [
        normalizedProductId,
        normalizedLotId || normalizedLotNo || "-",
        normalizedExpDate || "-",
      ].join("|");
      if (!normalizedProductId) {
        return { items: [], defaultUnitLevelId: "" };
      }

      const cached = unitCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const response = await productsApi.unitLevels(normalizedProductId, {
        lotId: normalizedLotId || undefined,
        lotNo: normalizedLotId ? undefined : normalizedLotNo || undefined,
        expDate: normalizedLotId ? undefined : normalizedExpDate || undefined,
      });
      unitCacheRef.current.set(cacheKey, response || { items: [], defaultUnitLevelId: "" });
      return response || { items: [], defaultUnitLevelId: "" };
    }

    async function hydrateRow(row) {
      if (!row.productId) return row;

      const lots = await loadLots(row.productId);
      const matchedLot =
        lots.find((lot) => lot.id === row.lotId) ||
        lots.find(
          (lot) =>
            lot.lotNo === toCleanText(row.lotNoSnapshot) &&
            lot.expDate === toCleanText(row.expDateSnapshot)
        ) ||
        null;

      const nextLotId = toCleanText(matchedLot?.id) || row.lotId;
      const nextLotNo = toCleanText(matchedLot?.lotNo) || row.lotNoSnapshot;
      const nextExpDate = toCleanText(matchedLot?.expDate) || row.expDateSnapshot;
      const unitResponse = await loadUnits(row.productId, {
        lotId: nextLotId,
        lotNoSnapshot: nextLotNo,
        expDateSnapshot: nextExpDate,
      });
      const unitOptions = normalizeUnitOptions(unitResponse);
      const chosenUnit = chooseUnitOption(
        unitOptions,
        row,
        toCleanText(unitResponse?.defaultUnitLevelId ?? unitResponse?.default_unit_level_id)
      );

      return {
        ...row,
        lotId: nextLotId,
        lotNoSnapshot: nextLotNo,
        expDateSnapshot: nextExpDate,
        unitLevelId: toCleanText(chosenUnit?.id) || row.unitLevelId,
        unitLabel: toCleanText(chosenUnit?.displayName) || row.unitLabel,
        lotOptions: lots,
        unitOptions,
        isLoadingLots: false,
        isLoadingUnits: false,
      };
    }

    async function bootstrap() {
      setIsBootstrapping(true);
      try {
        const requests = [productsApi.list("")];
        if (mode === "create") {
          requests.unshift(inventoryApi.listLocations({ locationType: "BRANCH" }));
        }

        const responses = await Promise.all(requests);
        if (isCancelled) return;

        if (mode === "create") {
          setBranches(Array.isArray(responses[0]) ? responses[0] : []);
          setProducts(Array.isArray(responses[1]) ? responses[1] : []);
        } else {
          setProducts(Array.isArray(responses[0]) ? responses[0] : []);
        }

        const [hydratedItems, hydratedActions] = await Promise.all([
          Promise.all(nextForm.items.map((row) => hydrateRow(row))),
          Promise.all(nextForm.resolutionActions.map((row) => hydrateRow(row))),
        ]);
        if (isCancelled) return;

        setForm((current) => ({
          ...current,
          items: hydratedItems,
          resolutionActions: hydratedActions,
        }));
      } catch (requestError) {
        if (!isCancelled) {
          setError(toCleanText(requestError?.message) || "โหลดข้อมูลสำหรับ incident report ไม่สำเร็จ");
        }
      } finally {
        if (!isCancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    void bootstrap();

    return () => {
      isCancelled = true;
    };
  }, [initialValues, mode, open]);

  async function loadLotsForProduct(productId) {
    const normalizedProductId = toCleanText(productId);
    if (!normalizedProductId) return [];

    const cached = lotCacheRef.current.get(normalizedProductId);
    if (cached) return cached;

    const response = await productsApi.lotWhitelists(normalizedProductId);
    const lots = normalizeLots(response?.lots);
    lotCacheRef.current.set(normalizedProductId, lots);
    return lots;
  }

  async function loadUnitOptionsForRow(productId, row) {
    const normalizedProductId = toCleanText(productId);
    if (!normalizedProductId) {
      return { options: [], defaultUnitLevelId: "" };
    }

    const normalizedLotId = toCleanText(row?.lotId);
    const normalizedLotNo = toCleanText(row?.lotNoSnapshot);
    const normalizedExpDate = toCleanText(row?.expDateSnapshot);
    const cacheKey = [
      normalizedProductId,
      normalizedLotId || normalizedLotNo || "-",
      normalizedExpDate || "-",
    ].join("|");

    let response = unitCacheRef.current.get(cacheKey);
    if (!response) {
      response = await productsApi.unitLevels(normalizedProductId, {
        lotId: normalizedLotId || undefined,
        lotNo: normalizedLotId ? undefined : normalizedLotNo || undefined,
        expDate: normalizedLotId ? undefined : normalizedExpDate || undefined,
      });
      unitCacheRef.current.set(cacheKey, response || { items: [], defaultUnitLevelId: "" });
    }

    return {
      options: normalizeUnitOptions(response),
      defaultUnitLevelId: toCleanText(response?.defaultUnitLevelId ?? response?.default_unit_level_id),
    };
  }

  function updateRows(kind, updater) {
    const key = kind === "resolutionActions" ? "resolutionActions" : "items";
    setForm((current) => ({
      ...current,
      [key]: current[key].map((row) => updater(row)),
    }));
  }

  function replaceRow(kind, rowKey, nextRow) {
    const key = kind === "resolutionActions" ? "resolutionActions" : "items";
    setForm((current) => ({
      ...current,
      [key]: current[key].map((row) => (row.key === rowKey ? nextRow : row)),
    }));
  }

  function handleFieldChange(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handlePatientFieldChange(field, value) {
    setForm((current) => ({
      ...current,
      resolutionPatient: {
        ...current.resolutionPatient,
        [field]: value,
      },
    }));
  }

  function handleRowFieldChange(kind, rowKey, field, value) {
    updateRows(kind, (row) =>
      row.key === rowKey
        ? {
            ...row,
            [field]: value,
          }
        : row
    );
  }

  function handleAddItem() {
    setForm((current) => ({
      ...current,
      items: [...current.items, createEmptyIncidentItem()],
    }));
  }

  function handleAddResolutionAction() {
    setForm((current) => ({
      ...current,
      resolutionActions: [
        ...current.resolutionActions,
        createEmptyResolutionAction({}, buildDefaultResolutionActionType(current)),
      ],
    }));
  }

  function handleRemoveRow(kind, rowKey) {
    const key = kind === "resolutionActions" ? "resolutionActions" : "items";
    setForm((current) => ({
      ...current,
      [key]: current[key].filter((row) => row.key !== rowKey),
    }));
  }

  async function handleRowProductChange(kind, rowKey, productId) {
    const rowCollection = kind === "resolutionActions" ? form.resolutionActions : form.items;
    const currentRow = rowCollection.find((row) => row.key === rowKey);
    const normalizedProductId = toCleanText(productId);

    replaceRow(kind, rowKey, {
      ...(currentRow || createEmptyIncidentItem()),
      ...(kind === "resolutionActions"
        ? { actionType: toCleanText(currentRow?.actionType).toUpperCase() || buildDefaultResolutionActionType(form) }
        : {}),
      key: rowKey,
      productId: normalizedProductId,
      lotId: "",
      lotNoSnapshot: "",
      expDateSnapshot: "",
      unitLevelId: "",
      unitLabel: "",
      lotOptions: [],
      unitOptions: [],
      isLoadingLots: Boolean(normalizedProductId),
      isLoadingUnits: Boolean(normalizedProductId),
    });

    if (!normalizedProductId) {
      return;
    }

    try {
      const lots = await loadLotsForProduct(normalizedProductId);
      const unitResult = await loadUnitOptionsForRow(normalizedProductId, {});
      const chosenUnit = chooseUnitOption(unitResult.options, {}, unitResult.defaultUnitLevelId);

      updateRows(kind, (row) =>
        row.key === rowKey
          ? {
              ...row,
              lotOptions: lots,
              unitOptions: unitResult.options,
              unitLevelId: toCleanText(chosenUnit?.id),
              unitLabel: toCleanText(chosenUnit?.displayName),
              isLoadingLots: false,
              isLoadingUnits: false,
            }
          : row
      );
    } catch (requestError) {
      setError(toCleanText(requestError?.message) || "โหลดสินค้า/lot สำหรับ corrective action ไม่สำเร็จ");
      updateRows(kind, (row) =>
        row.key === rowKey
          ? {
              ...row,
              lotOptions: [],
              unitOptions: [],
              unitLevelId: "",
              unitLabel: "",
              isLoadingLots: false,
              isLoadingUnits: false,
            }
          : row
      );
    }
  }

  async function handleRowLotChange(kind, rowKey, lotId) {
    const rowCollection = kind === "resolutionActions" ? form.resolutionActions : form.items;
    const currentRow = rowCollection.find((row) => row.key === rowKey);
    if (!currentRow) return;

    const selectedLot =
      currentRow.lotOptions.find((lot) => lot.id === toCleanText(lotId)) || null;

    updateRows(kind, (row) =>
      row.key === rowKey
        ? {
            ...row,
            lotId: toCleanText(lotId),
            lotNoSnapshot: toCleanText(selectedLot?.lotNo),
            expDateSnapshot: toCleanText(selectedLot?.expDate),
            unitLevelId: "",
            unitLabel: "",
            unitOptions: [],
            isLoadingUnits: Boolean(currentRow.productId),
          }
        : row
    );

    if (!currentRow.productId) {
      return;
    }

    try {
      const unitResult = await loadUnitOptionsForRow(currentRow.productId, {
        lotId,
        lotNoSnapshot: toCleanText(selectedLot?.lotNo),
        expDateSnapshot: toCleanText(selectedLot?.expDate),
      });
      const nextRowSeed = {
        lotId,
        lotNoSnapshot: toCleanText(selectedLot?.lotNo),
        expDateSnapshot: toCleanText(selectedLot?.expDate),
      };
      const chosenUnit = chooseUnitOption(unitResult.options, nextRowSeed, unitResult.defaultUnitLevelId);

      updateRows(kind, (row) =>
        row.key === rowKey
          ? {
              ...row,
              unitOptions: unitResult.options,
              unitLevelId: toCleanText(chosenUnit?.id),
              unitLabel: toCleanText(chosenUnit?.displayName),
              isLoadingUnits: false,
            }
          : row
      );
    } catch (requestError) {
      setError(toCleanText(requestError?.message) || "โหลดหน่วยสำหรับ lot ที่เลือกไม่สำเร็จ");
      updateRows(kind, (row) =>
        row.key === rowKey
          ? {
              ...row,
              unitOptions: [],
              unitLevelId: "",
              unitLabel: "",
              isLoadingUnits: false,
            }
          : row
      );
    }
  }

  function handleRowUnitChange(kind, rowKey, unitLevelId) {
    const rowCollection = kind === "resolutionActions" ? form.resolutionActions : form.items;
    const currentRow = rowCollection.find((row) => row.key === rowKey);
    const selectedOption =
      currentRow?.unitOptions.find((option) => option.id === toCleanText(unitLevelId)) || null;

    updateRows(kind, (row) =>
      row.key === rowKey
        ? {
            ...row,
            unitLevelId: toCleanText(unitLevelId),
            unitLabel: toCleanText(selectedOption?.displayName),
          }
        : row
    );
  }

  function handleBackdropClick(event) {
    if (event.target !== event.currentTarget || isSaving) {
      return;
    }
    onClose?.();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSaving) return;

    const activeItems = form.items.filter(hasAnyIncidentItemValue);
    const activeResolutionActions = form.resolutionActions.filter(hasAnyResolutionActionValue);

    if (mode === "create") {
      if (!toCleanText(form.incidentType)) {
        setError("incidentType is required");
        return;
      }
      if (!toCleanText(form.incidentReason)) {
        setError("incidentReason is required");
        return;
      }
      if (!toCleanText(form.branchCode)) {
        setError("กรุณาเลือกสาขา");
        return;
      }
      if (!toCleanText(form.happenedAt)) {
        setError("happenedAt is required");
        return;
      }
      if (!toCleanText(form.incidentDescription)) {
        setError("กรุณาระบุ description");
        return;
      }
    }

    if (mode === "resolve" && !toCleanText(incidentId)) {
      setError("incident id is required for resolution mode");
      return;
    }

    for (const [index, row] of activeItems.entries()) {
      if (!toCleanText(row.productId)) {
        setError(`related item แถวที่ ${index + 1} ยังไม่ได้เลือกสินค้า`);
        return;
      }
      const qty = Number(row.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        setError(`related item แถวที่ ${index + 1} ต้องระบุจำนวนเป็นเลขบวก`);
        return;
      }
      if (!toCleanText(row.unitLevelId) && !toCleanText(row.unitLabel)) {
        setError(`related item แถวที่ ${index + 1} ต้องระบุหน่วย`);
        return;
      }
    }

    for (const [index, row] of activeResolutionActions.entries()) {
      if (!toCleanText(row.actionType)) {
        setError(`corrective action แถวที่ ${index + 1} ยังไม่ได้เลือกประเภท`);
        return;
      }
      if (!toCleanText(row.productId)) {
        setError(`corrective action แถวที่ ${index + 1} ยังไม่ได้เลือกสินค้า`);
        return;
      }
      const qty = Number(row.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        setError(`corrective action แถวที่ ${index + 1} ต้องระบุจำนวนเป็นเลขบวก`);
        return;
      }
      if (!toCleanText(row.unitLevelId) && !toCleanText(row.unitLabel)) {
        setError(`corrective action แถวที่ ${index + 1} ต้องระบุหน่วย`);
        return;
      }
    }

    const requiresPatient = activeResolutionActions.some(
      (row) => toCleanText(row.actionType).toUpperCase() === "RETROSPECTIVE_DISPENSE"
    );
    if (requiresPatient) {
      if (!toCleanText(form.resolutionPatient.pid)) {
        setError("กรุณาระบุเลขประจำตัวประชาชนสำหรับ retrospective dispense");
        return;
      }
      if (!toCleanText(form.resolutionPatient.fullName)) {
        setError("กรุณาระบุชื่อผู้รับมอบยาสำหรับ retrospective dispense");
        return;
      }
    }

    if (mode === "resolve" && !activeResolutionActions.length) {
      setError("ต้องมี corrective action อย่างน้อย 1 รายการ");
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const payload = {
        incidentType: form.incidentType,
        incidentReason: form.incidentReason,
        incidentDescription: form.incidentDescription,
        branchCode: form.branchCode,
        happenedAt: form.happenedAt,
        status: form.status,
        note: form.note,
        smartcardSessionId: form.smartcardSessionId || undefined,
        dispenseAttemptId: form.dispenseAttemptId || undefined,
        items: activeItems.map((row) => ({
          productId: row.productId,
          lotId: row.lotId || undefined,
          qty: Number(row.qty),
          unitLevelId: row.unitLevelId || undefined,
          unitLabel: row.unitLabel || undefined,
          lotNoSnapshot: row.lotNoSnapshot || undefined,
          expDateSnapshot: row.expDateSnapshot || undefined,
          note: row.note || undefined,
        })),
        resolutionActions: activeResolutionActions.map((row) => ({
          actionType: row.actionType,
          productId: row.productId,
          lotId: row.lotId || undefined,
          qty: Number(row.qty),
          unitLevelId: row.unitLevelId || undefined,
          unitLabel: row.unitLabel || undefined,
          lotNoSnapshot: row.lotNoSnapshot || undefined,
          expDateSnapshot: row.expDateSnapshot || undefined,
          note: row.note || undefined,
        })),
        resolutionPatient: showResolutionPatient ? form.resolutionPatient : undefined,
      };

      if (mode === "resolve") {
        const response = await adminApi.applyIncidentResolution(incidentId, payload);
        onResolved?.(response?.incident || null);
      } else {
        const response = await adminApi.createIncident(payload);
        onCreated?.(response?.incident || null);
      }
      onClose?.();
    } catch (requestError) {
      setError(toCleanText(requestError?.message) || "บันทึก incident / corrective action ไม่สำเร็จ");
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="admin-incident-modal" onClick={handleBackdropClick}>
      <div
        className="admin-incident-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-incident-modal-title"
      >
        <div className="admin-incident-modal__header">
          <div>
            <p className="admin-incident-modal__eyebrow">Admin Governance Layer</p>
            <h2 id="admin-incident-modal-title">{title}</h2>
            <p>
              {mode === "resolve"
                ? "ฟอร์มนี้ใช้เพิ่ม stock correction หรือ retrospective dispense ให้กับ incident เดิม โดยทุก movement และ dispense ที่สร้างจะ trace กลับไป incident code เดียวกัน"
                : "ฟอร์มนี้ใช้บันทึก incident report และถ้าต้องการสามารถสร้าง corrective action ที่ผูกกลับไป incident เดียวกันได้ทันที"}
            </p>
          </div>
          <button
            type="button"
            className="admin-incident-modal__close"
            onClick={() => onClose?.()}
            disabled={isSaving}
          >
            ปิด
          </button>
        </div>

        {error ? (
          <div className="admin-incident-modal__feedback admin-incident-modal__feedback--error">
            {error}
          </div>
        ) : null}

        <ResolutionSummary initialValues={initialValues} mode={mode} />

        <form className="admin-incident-modal__form" onSubmit={(event) => void handleSubmit(event)}>
          {mode === "create" ? (
            <>
              <div className="admin-incident-modal__grid">
                <label className="admin-incident-modal__field">
                  <span>Incident type</span>
                  <select
                    value={form.incidentType}
                    onChange={(event) => handleFieldChange("incidentType", event.target.value)}
                    disabled={isBootstrapping || isSaving}
                  >
                    {ADMIN_INCIDENT_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="admin-incident-modal__field">
                  <span>Incident reason</span>
                  <select
                    value={form.incidentReason}
                    onChange={(event) => handleFieldChange("incidentReason", event.target.value)}
                    disabled={isBootstrapping || isSaving}
                  >
                    {ADMIN_INCIDENT_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="admin-incident-modal__field">
                  <span>Branch</span>
                  <select
                    value={form.branchCode}
                    onChange={(event) => handleFieldChange("branchCode", event.target.value)}
                    disabled={isBootstrapping || isSaving}
                  >
                    <option value="">เลือกสาขา</option>
                    {branchOptions.map((branch) => (
                      <option key={branch.id || branch.code} value={branch.code}>
                        {getBranchDisplay(branch)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="admin-incident-modal__field">
                  <span>Happened at</span>
                  <input
                    type="datetime-local"
                    value={form.happenedAt}
                    onChange={(event) => handleFieldChange("happenedAt", event.target.value)}
                    disabled={isSaving}
                  />
                </label>

                <label className="admin-incident-modal__field">
                  <span>Status</span>
                  <select
                    value={form.status}
                    onChange={(event) => handleFieldChange("status", event.target.value)}
                    disabled={isSaving}
                  >
                    {ADMIN_INCIDENT_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="admin-incident-modal__field">
                  <span>Smartcard session id</span>
                  <input
                    type="text"
                    value={form.smartcardSessionId}
                    onChange={(event) => handleFieldChange("smartcardSessionId", event.target.value)}
                    disabled={isSaving}
                    placeholder="optional"
                  />
                </label>

                <label className="admin-incident-modal__field">
                  <span>Dispense attempt id</span>
                  <input
                    type="text"
                    value={form.dispenseAttemptId}
                    onChange={(event) => handleFieldChange("dispenseAttemptId", event.target.value)}
                    disabled={isSaving}
                    placeholder="optional"
                  />
                </label>
              </div>

              <label className="admin-incident-modal__field">
                <span>Description</span>
                <textarea
                  rows={4}
                  value={form.incidentDescription}
                  onChange={(event) => handleFieldChange("incidentDescription", event.target.value)}
                  disabled={isSaving}
                  placeholder="อธิบายเหตุการณ์ให้ชัดเจนว่าเกิดอะไรขึ้น, ทำไมจึงผิด process, และ corrective action ที่ต้องทำคืออะไร"
                />
              </label>

              <label className="admin-incident-modal__field">
                <span>Note / reference</span>
                <textarea
                  rows={3}
                  value={form.note}
                  onChange={(event) => handleFieldChange("note", event.target.value)}
                  disabled={isSaving}
                  placeholder="ข้อมูลอ้างอิงเพิ่มเติม เช่น ticket, โทรศัพท์ติดต่อ, หรือคำอธิบายภายใน"
                />
              </label>
            </>
          ) : null}

          <section className="admin-incident-modal__items">
            <div className="admin-incident-modal__items-header">
              <div>
                <h3>Related product snapshots</h3>
                <p>เก็บ snapshot ของสินค้า/lot/qty ใน incident เพื่อใช้เป็นหลักฐาน audit</p>
              </div>
              <button
                type="button"
                className="admin-incident-modal__secondary"
                onClick={handleAddItem}
                disabled={isSaving || mode === "resolve"}
              >
                เพิ่มสินค้า
              </button>
            </div>

            {form.items.length ? (
              <div className="admin-incident-modal__item-list">
                {form.items.map((row, index) => (
                  <ProductRowCard
                    key={row.key}
                    row={row}
                    index={index}
                    title="Item"
                    productOptions={productOptions}
                    productMap={productMap}
                    disabled={isBootstrapping || isSaving || mode === "resolve"}
                    onRemove={() => handleRemoveRow("items", row.key)}
                    onProductChange={(productId) => handleRowProductChange("items", row.key, productId)}
                    onLotChange={(lotId) => handleRowLotChange("items", row.key, lotId)}
                    onUnitChange={(unitLevelId) => handleRowUnitChange("items", row.key, unitLevelId)}
                    onFieldChange={(field, value) => handleRowFieldChange("items", row.key, field, value)}
                  />
                ))}
              </div>
            ) : (
              <div className="admin-incident-modal__empty">
                {mode === "resolve"
                  ? "incident นี้ไม่มี related item snapshots เดิม แต่ยังเพิ่ม corrective action ใหม่ได้"
                  : 'ยังไม่มี item rows ถ้าต้องการเก็บข้อมูลสินค้า/lot/qty เพิ่มเติม ให้กด "เพิ่มสินค้า"'}
              </div>
            )}
          </section>

          <section className="admin-incident-modal__items admin-incident-modal__items--resolution">
            <div className="admin-incident-modal__items-header">
              <div>
                <h3>Corrective actions</h3>
                <p>
                  เลือกได้ว่าจะเพิ่ม stock, ลด stock หรือสร้าง retrospective dispense
                  พร้อมผูกอ้างอิงกลับไป incident เดียวกัน
                </p>
              </div>
              <button
                type="button"
                className="admin-incident-modal__secondary"
                onClick={handleAddResolutionAction}
                disabled={isSaving}
              >
                เพิ่ม corrective action
              </button>
            </div>

            {form.resolutionActions.length ? (
              <div className="admin-incident-modal__item-list">
                {form.resolutionActions.map((row, index) => (
                  <ProductRowCard
                    key={row.key}
                    row={row}
                    index={index}
                    title="Action"
                    productOptions={productOptions}
                    productMap={productMap}
                    disabled={isBootstrapping || isSaving}
                    onRemove={() => handleRemoveRow("resolutionActions", row.key)}
                    onProductChange={(productId) =>
                      handleRowProductChange("resolutionActions", row.key, productId)
                    }
                    onLotChange={(lotId) =>
                      handleRowLotChange("resolutionActions", row.key, lotId)
                    }
                    onUnitChange={(unitLevelId) =>
                      handleRowUnitChange("resolutionActions", row.key, unitLevelId)
                    }
                    onFieldChange={(field, value) =>
                      handleRowFieldChange("resolutionActions", row.key, field, value)
                    }
                  >
                    <label className="admin-incident-modal__field">
                      <span>Action type</span>
                      <select
                        value={row.actionType}
                        onChange={(event) =>
                          handleRowFieldChange("resolutionActions", row.key, "actionType", event.target.value)
                        }
                        disabled={isSaving}
                      >
                        {ADMIN_INCIDENT_RESOLUTION_ACTION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </ProductRowCard>
                ))}
              </div>
            ) : (
              <div className="admin-incident-modal__empty">
                ยังไม่มี corrective action ถ้าต้องการให้ incident นี้ตัด/เพิ่ม stock
                หรือสร้าง dispense ย้อนหลัง ให้เพิ่มรายการในส่วนนี้
              </div>
            )}
          </section>

          {showResolutionPatient ? (
            <section className="admin-incident-modal__patient">
              <div className="admin-incident-modal__items-header">
                <div>
                  <h3>Fallback patient for retrospective dispense</h3>
                  <p>
                    ใช้เมื่อ corrective action เป็นการสร้าง dispense ย้อนหลังจาก incident
                    โดยไม่มี smartcard session เดิม
                  </p>
                </div>
              </div>

              <div className="admin-incident-modal__grid">
                <label className="admin-incident-modal__field">
                  <span>เลขประจำตัวประชาชน</span>
                  <input
                    type="text"
                    value={form.resolutionPatient.pid}
                    onChange={(event) => handlePatientFieldChange("pid", event.target.value)}
                    disabled={isSaving}
                    placeholder="เช่น 1103000134333"
                  />
                </label>

                <label className="admin-incident-modal__field">
                  <span>ชื่อผู้รับมอบยา</span>
                  <input
                    type="text"
                    value={form.resolutionPatient.fullName}
                    onChange={(event) => handlePatientFieldChange("fullName", event.target.value)}
                    disabled={isSaving}
                    placeholder="ชื่อ-สกุล"
                  />
                </label>

                <label className="admin-incident-modal__field">
                  <span>ชื่อภาษาอังกฤษ</span>
                  <input
                    type="text"
                    value={form.resolutionPatient.englishName}
                    onChange={(event) => handlePatientFieldChange("englishName", event.target.value)}
                    disabled={isSaving}
                    placeholder="optional"
                  />
                </label>

                <label className="admin-incident-modal__field">
                  <span>วันเกิด</span>
                  <input
                    type="date"
                    value={form.resolutionPatient.birthDate}
                    onChange={(event) => handlePatientFieldChange("birthDate", event.target.value)}
                    disabled={isSaving}
                  />
                </label>

                <label className="admin-incident-modal__field">
                  <span>เพศ</span>
                  <select
                    value={form.resolutionPatient.sex}
                    onChange={(event) => handlePatientFieldChange("sex", event.target.value)}
                    disabled={isSaving}
                  >
                    <option value="">ไม่ระบุ</option>
                    <option value="MALE">ชาย</option>
                    <option value="FEMALE">หญิง</option>
                    <option value="OTHER">อื่น ๆ</option>
                    <option value="UNKNOWN">UNKNOWN</option>
                  </select>
                </label>

                <label className="admin-incident-modal__field">
                  <span>สถานที่ออกบัตร</span>
                  <input
                    type="text"
                    value={form.resolutionPatient.cardIssuePlace}
                    onChange={(event) => handlePatientFieldChange("cardIssuePlace", event.target.value)}
                    disabled={isSaving}
                    placeholder="optional"
                  />
                </label>

                <label className="admin-incident-modal__field">
                  <span>วันที่ออกบัตร</span>
                  <input
                    type="date"
                    value={form.resolutionPatient.cardIssuedDate}
                    onChange={(event) => handlePatientFieldChange("cardIssuedDate", event.target.value)}
                    disabled={isSaving}
                  />
                </label>

                <label className="admin-incident-modal__field">
                  <span>วันหมดอายุบัตร</span>
                  <input
                    type="date"
                    value={form.resolutionPatient.cardExpiryDate}
                    onChange={(event) => handlePatientFieldChange("cardExpiryDate", event.target.value)}
                    disabled={isSaving}
                  />
                </label>
              </div>

              <label className="admin-incident-modal__field">
                <span>ที่อยู่</span>
                <textarea
                  rows={3}
                  value={form.resolutionPatient.addressText}
                  onChange={(event) => handlePatientFieldChange("addressText", event.target.value)}
                  disabled={isSaving}
                  placeholder="ที่อยู่ตามข้อมูลที่ตรวจสอบได้"
                />
              </label>
            </section>
          ) : null}

          <div className="admin-incident-modal__actions">
            <button
              type="button"
              className="admin-incident-modal__secondary"
              onClick={() => onClose?.()}
              disabled={isSaving}
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="admin-incident-modal__primary"
              disabled={isBootstrapping || isSaving}
            >
              {isSaving
                ? "กำลังบันทึก..."
                : mode === "resolve"
                ? "บันทึก corrective actions"
                : "บันทึก incident report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
