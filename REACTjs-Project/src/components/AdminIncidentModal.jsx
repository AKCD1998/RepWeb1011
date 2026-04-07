import { useEffect, useMemo, useRef, useState } from "react";
import { adminApi, inventoryApi, productsApi } from "../lib/api";
import {
  ADMIN_INCIDENT_REASON_OPTIONS,
  ADMIN_INCIDENT_STATUS_OPTIONS,
  ADMIN_INCIDENT_TYPE_OPTIONS,
  createAdminIncidentLocalDateTimeValue,
} from "../lib/adminIncidents";
import "./AdminIncidentModal.css";

function toCleanText(value) {
  return String(value ?? "").trim();
}

function createItemKey() {
  return `incident-item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyIncidentItem(seed = {}) {
  return {
    key: createItemKey(),
    productId: toCleanText(seed?.productId ?? seed?.product_id),
    lotId: toCleanText(seed?.lotId ?? seed?.lot_id),
    qty: toCleanText(seed?.qty ?? "1"),
    unitLabel: toCleanText(
      seed?.unitLabel ?? seed?.unit_label ?? seed?.unitLabelSnapshot ?? seed?.unit_label_snapshot
    ),
    lotNoSnapshot: toCleanText(seed?.lotNoSnapshot ?? seed?.lot_no_snapshot ?? seed?.lotNo ?? seed?.lot_no),
    expDateSnapshot: toCleanText(seed?.expDateSnapshot ?? seed?.exp_date_snapshot),
    note: toCleanText(seed?.note ?? seed?.noteText ?? seed?.note_text),
    lotOptions: [],
    isLoadingLots: false,
  };
}

function createInitialFormState(initialValues = {}) {
  const seededItems = Array.isArray(initialValues?.items) ? initialValues.items : [];
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
  };
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

export default function AdminIncidentModal({
  open,
  onClose,
  onCreated,
  initialValues,
  title = "สร้าง Incident Report",
}) {
  const lotCacheRef = useRef(new Map());
  const [form, setForm] = useState(() => createInitialFormState(initialValues));
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

  useEffect(() => {
    if (!open) return;

    let isCancelled = false;
    const nextForm = createInitialFormState(initialValues);
    setForm(nextForm);
    setError("");

    async function bootstrap() {
      setIsBootstrapping(true);
      try {
        const [branchRows, productRows] = await Promise.all([
          inventoryApi.listLocations({ locationType: "BRANCH" }),
          productsApi.list(""),
        ]);
        if (isCancelled) return;

        setBranches(Array.isArray(branchRows) ? branchRows : []);
        setProducts(Array.isArray(productRows) ? productRows : []);

        if (nextForm.items.length) {
          const rowsWithLots = await Promise.all(
            nextForm.items.map(async (row) => {
              if (!row.productId) {
                return row;
              }
              try {
                const lotRows = await loadLotsForProduct(row.productId);
                return {
                  ...row,
                  lotOptions: lotRows,
                };
              } catch {
                return row;
              }
            })
          );
          if (!isCancelled) {
            setForm((current) => ({
              ...current,
              items: rowsWithLots,
            }));
          }
        }
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

    async function loadLotsForProduct(productId) {
      const key = toCleanText(productId);
      if (!key) return [];
      const cached = lotCacheRef.current.get(key);
      if (cached) {
        return cached;
      }
      const response = await productsApi.lotWhitelists(key);
      const lotRows = normalizeLots(response?.lots);
      lotCacheRef.current.set(key, lotRows);
      return lotRows;
    }

    void bootstrap();

    return () => {
      isCancelled = true;
    };
  }, [initialValues, open]);

  async function loadLotsForRow(rowKey, productId) {
    const safeProductId = toCleanText(productId);
    if (!safeProductId) {
      setForm((current) => ({
        ...current,
        items: current.items.map((row) =>
          row.key === rowKey
            ? {
                ...row,
                lotOptions: [],
                isLoadingLots: false,
              }
            : row
        ),
      }));
      return;
    }

    setForm((current) => ({
      ...current,
      items: current.items.map((row) =>
        row.key === rowKey
          ? {
              ...row,
              isLoadingLots: true,
            }
          : row
      ),
    }));

    try {
      let lots = lotCacheRef.current.get(safeProductId);
      if (!lots) {
        const response = await productsApi.lotWhitelists(safeProductId);
        lots = normalizeLots(response?.lots);
        lotCacheRef.current.set(safeProductId, lots);
      }

      setForm((current) => ({
        ...current,
        items: current.items.map((row) =>
          row.key === rowKey
            ? {
                ...row,
                lotOptions: lots,
                isLoadingLots: false,
              }
            : row
        ),
      }));
    } catch (requestError) {
      setError(toCleanText(requestError?.message) || "โหลด lot สำหรับ incident item ไม่สำเร็จ");
      setForm((current) => ({
        ...current,
        items: current.items.map((row) =>
          row.key === rowKey
            ? {
                ...row,
                lotOptions: [],
                isLoadingLots: false,
              }
            : row
        ),
      }));
    }
  }

  function handleFieldChange(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleItemFieldChange(rowKey, field, value) {
    setForm((current) => ({
      ...current,
      items: current.items.map((row) =>
        row.key === rowKey
          ? {
              ...row,
              [field]: value,
            }
          : row
      ),
    }));
  }

  function handleAddItem() {
    setForm((current) => ({
      ...current,
      items: [...current.items, createEmptyIncidentItem()],
    }));
  }

  function handleRemoveItem(rowKey) {
    setForm((current) => ({
      ...current,
      items: current.items.filter((row) => row.key !== rowKey),
    }));
  }

  async function handleProductChange(rowKey, productId) {
    setForm((current) => ({
      ...current,
      items: current.items.map((row) =>
        row.key === rowKey
          ? {
              ...row,
              productId,
              lotId: "",
              lotOptions: [],
              isLoadingLots: Boolean(productId),
            }
          : row
      ),
    }));
    await loadLotsForRow(rowKey, productId);
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

    const activeItems = form.items.filter(
      (row) =>
        row.productId ||
        row.lotId ||
        row.qty ||
        row.unitLabel ||
        row.note ||
        row.lotNoSnapshot ||
        row.expDateSnapshot
    );

    for (const [index, row] of activeItems.entries()) {
      if (!toCleanText(row.productId)) {
        setError(`รายการสินค้า incident แถวที่ ${index + 1} ยังไม่ได้เลือกสินค้า`);
        return;
      }
      const qty = Number(row.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        setError(`รายการสินค้า incident แถวที่ ${index + 1} ต้องระบุจำนวนเป็นเลขบวก`);
        return;
      }
    }

    setIsSaving(true);
    setError("");

    try {
      const response = await adminApi.createIncident({
        incidentType: form.incidentType,
        incidentReason: form.incidentReason,
        incidentDescription: form.incidentDescription,
        branchCode: form.branchCode,
        happenedAt: form.happenedAt,
        status: form.status,
        note: form.note,
        smartcardSessionId: form.smartcardSessionId,
        dispenseAttemptId: form.dispenseAttemptId,
        items: activeItems.map((row) => ({
          productId: row.productId,
          lotId: row.lotId || undefined,
          qty: Number(row.qty),
          unitLabel: row.unitLabel || undefined,
          lotNoSnapshot: row.lotNoSnapshot || undefined,
          expDateSnapshot: row.expDateSnapshot || undefined,
          note: row.note || undefined,
        })),
      });

      onCreated?.(response?.incident || null);
      onClose?.();
    } catch (requestError) {
      setError(toCleanText(requestError?.message) || "บันทึก incident report ไม่สำเร็จ");
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
              ฟอร์มนี้ใช้บันทึกเหตุผิดปกติแยกจาก dispense โดยเด็ดขาด และจะไม่สร้าง patient,
              dispense หรือ stock movement ใด ๆ
            </p>
          </div>
          <button type="button" className="admin-incident-modal__close" onClick={() => onClose?.()} disabled={isSaving}>
            ปิด
          </button>
        </div>

        {error ? <div className="admin-incident-modal__feedback admin-incident-modal__feedback--error">{error}</div> : null}

        <form className="admin-incident-modal__form" onSubmit={(event) => void handleSubmit(event)}>
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
              placeholder="อธิบายเหตุการณ์ให้ชัดเจนว่าเกิดอะไรขึ้น, ทำไมจึงผิด process, และ admin รับทราบอย่างไร"
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

          <section className="admin-incident-modal__items">
            <div className="admin-incident-modal__items-header">
              <div>
                <h3>Related product rows</h3>
                <p>ส่วนนี้เป็น optional และจะเก็บ snapshot ของสินค้า/lot/qty แยกจากธุรกรรมหลัก</p>
              </div>
              <button type="button" className="admin-incident-modal__secondary" onClick={handleAddItem} disabled={isSaving}>
                เพิ่มสินค้า
              </button>
            </div>

            {form.items.length ? (
              <div className="admin-incident-modal__item-list">
                {form.items.map((row, index) => {
                  const selectedProduct = productMap.get(row.productId);
                  return (
                    <div key={row.key} className="admin-incident-modal__item-card">
                      <div className="admin-incident-modal__item-card-header">
                        <strong>Item {index + 1}</strong>
                        <button
                          type="button"
                          className="admin-incident-modal__remove"
                          onClick={() => handleRemoveItem(row.key)}
                          disabled={isSaving}
                        >
                          ลบ
                        </button>
                      </div>

                      <div className="admin-incident-modal__item-grid">
                        <label className="admin-incident-modal__field">
                          <span>Product</span>
                          <select
                            value={row.productId}
                            onChange={(event) => void handleProductChange(row.key, event.target.value)}
                            disabled={isBootstrapping || isSaving}
                          >
                            <option value="">เลือกสินค้า</option>
                            {productOptions.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.productCode
                                  ? `${product.productCode} : ${product.tradeName}`
                                  : product.tradeName}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="admin-incident-modal__field">
                          <span>Lot (optional)</span>
                          <select
                            value={row.lotId}
                            onChange={(event) => handleItemFieldChange(row.key, "lotId", event.target.value)}
                            disabled={!row.productId || row.isLoadingLots || isSaving}
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
                                {lot.expDate ? `${lot.lotNo} (exp ${lot.expDate})` : lot.lotNo}
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
                            onChange={(event) => handleItemFieldChange(row.key, "qty", event.target.value)}
                            disabled={isSaving}
                            placeholder="0"
                          />
                        </label>

                        <label className="admin-incident-modal__field">
                          <span>Unit label snapshot</span>
                          <input
                            type="text"
                            value={row.unitLabel}
                            onChange={(event) => handleItemFieldChange(row.key, "unitLabel", event.target.value)}
                            disabled={isSaving}
                            placeholder="เช่น เม็ด / กล่อง / blister"
                          />
                        </label>
                      </div>

                      {selectedProduct ? (
                        <div className="admin-incident-modal__item-summary">
                          <span>สินค้า: {selectedProduct.tradeName}</span>
                          <span>รหัส: {selectedProduct.productCode || "-"}</span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="admin-incident-modal__empty">
                ยังไม่มี item rows ถ้าต้องการเก็บข้อมูลสินค้า/lot/qty เพิ่มเติม ให้กด "เพิ่มสินค้า"
              </div>
            )}
          </section>

          <div className="admin-incident-modal__actions">
            <button type="button" className="admin-incident-modal__secondary" onClick={() => onClose?.()} disabled={isSaving}>
              ยกเลิก
            </button>
            <button type="submit" className="admin-incident-modal__primary" disabled={isBootstrapping || isSaving}>
              {isSaving ? "กำลังบันทึก..." : "บันทึก incident report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
