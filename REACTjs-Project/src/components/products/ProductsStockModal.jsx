import { useEffect, useMemo, useRef, useState } from "react";
import { useOptionalAuth } from "../../context/AuthContext";
import { formatDateOnlyDisplay } from "../../lib/dateOnly";
import { inventoryApi } from "../../lib/api";
import "./ProductsStockModal.css";

function toCleanText(value) {
  return String(value || "").trim();
}

function normalizeRole(value) {
  return toCleanText(value).toUpperCase();
}

function normalizeErrorText(error) {
  if (!error) return "Request failed";
  if (typeof error === "string") return error;
  return error.message || "Request failed";
}

function formatStockQuantityNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  const normalized = Object.is(numeric, -0) ? 0 : numeric;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(normalized);
}

function formatStockQuantityWithUnit(value, unitLabel = "") {
  const quantity = formatStockQuantityNumber(value);
  const safeUnitLabel = toCleanText(unitLabel);
  if (quantity === "-") return quantity;
  return safeUnitLabel ? `${quantity} ${safeUnitLabel}` : quantity;
}

function formatBranchLabel(branchCode, branchName) {
  const code = toCleanText(branchCode);
  const name = toCleanText(branchName);
  if (code && name) return `${code} : ${name}`;
  return code || name || "-";
}

function normalizeLocationRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      code: toCleanText(row?.code),
      name: toCleanText(row?.name),
      type: normalizeRole(row?.type),
      isActive: Boolean(row?.isActive ?? row?.is_active),
    }))
    .filter((row) => row.code && row.type === "BRANCH");
}

function normalizeStockOnHandRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      branchCode: toCleanText(row?.branchCode ?? row?.branch_code),
      branchName: toCleanText(row?.branchName ?? row?.branch_name),
      productId: toCleanText(row?.productId ?? row?.product_id),
      lotId: toCleanText(row?.lotId ?? row?.lot_id),
      lotNo: toCleanText(row?.lotNo ?? row?.lot_no),
      expDate: toCleanText(row?.expDate ?? row?.exp_date),
      quantity: Number(row?.quantity ?? row?.quantityBase ?? row?.quantity_base ?? 0),
      unitLabel: toCleanText(row?.unitLabel ?? row?.unit_label),
      baseUnitLabel: toCleanText(row?.baseUnitLabel ?? row?.base_unit_label),
    }))
    .filter((row) => Number.isFinite(row.quantity));
}

function summarizeStockRowsByLot(rows) {
  const lotsByKey = new Map();
  const branchCodes = new Set();
  let totalQuantity = 0;
  let totalUnitLabel = "";

  for (const row of rows) {
    const quantity = Number(row.quantity || 0);
    const unitLabel = row.baseUnitLabel || row.unitLabel;
    const branchKey = row.branchCode || row.branchName || "";

    totalQuantity += quantity;
    if (branchKey) {
      branchCodes.add(branchKey);
    }
    if (!totalUnitLabel && unitLabel) {
      totalUnitLabel = unitLabel;
    }

    const lotKey = row.lotId || `${row.lotNo || "__NO_LOT__"}|${row.expDate || "__NO_EXP__"}`;
    if (!lotsByKey.has(lotKey)) {
      lotsByKey.set(lotKey, {
        key: lotKey,
        lotId: row.lotId,
        lotNo: row.lotNo,
        expDate: row.expDate,
        quantity: 0,
        unitLabel,
        branchMap: new Map(),
      });
    }

    const lot = lotsByKey.get(lotKey);
    lot.quantity += quantity;
    if (!lot.unitLabel && unitLabel) {
      lot.unitLabel = unitLabel;
    }

    const branchSummaryKey = branchKey || `__ROW__${lot.branchMap.size}`;
    if (!lot.branchMap.has(branchSummaryKey)) {
      lot.branchMap.set(branchSummaryKey, {
        branchCode: row.branchCode,
        branchName: row.branchName,
        quantity: 0,
      });
    }
    lot.branchMap.get(branchSummaryKey).quantity += quantity;
  }

  const lots = [...lotsByKey.values()]
    .map((lot) => ({
      key: lot.key,
      lotId: lot.lotId,
      lotNo: lot.lotNo,
      expDate: lot.expDate,
      quantity: lot.quantity,
      unitLabel: lot.unitLabel,
      branches: [...lot.branchMap.values()].sort((left, right) => {
        const leftKey = `${left.branchCode}|${left.branchName}`;
        const rightKey = `${right.branchCode}|${right.branchName}`;
        return leftKey.localeCompare(rightKey);
      }),
    }))
    .sort((left, right) => {
      const leftExp = left.expDate || "9999-12-31";
      const rightExp = right.expDate || "9999-12-31";
      if (leftExp !== rightExp) return leftExp.localeCompare(rightExp);
      return (left.lotNo || "").localeCompare(right.lotNo || "");
    });

  return {
    lots,
    totalQuantity,
    totalUnitLabel,
    lotCount: lots.length,
    branchCount: branchCodes.size,
  };
}

export default function ProductsStockModal({ product, onClose }) {
  const auth = useOptionalAuth();
  const userRole = normalizeRole(auth?.user?.role);
  const isAdmin = userRole === "ADMIN";
  const userBranchCode = toCleanText(auth?.user?.branchCode || auth?.user?.branch_code);
  const [branchOptions, setBranchOptions] = useState([]);
  const [selectedBranchCode, setSelectedBranchCode] = useState(isAdmin ? "" : userBranchCode);
  const [rows, setRows] = useState([]);
  const [isLoadingStock, setIsLoadingStock] = useState(false);
  const [stockError, setStockError] = useState("");
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [branchLoadError, setBranchLoadError] = useState("");
  const stockRequestSeqRef = useRef(0);
  const branchRequestSeqRef = useRef(0);

  const productId = toCleanText(product?.id);
  const summary = useMemo(() => summarizeStockRowsByLot(rows), [rows]);
  const selectedBranch = useMemo(
    () => branchOptions.find((option) => option.code === selectedBranchCode) || null,
    [branchOptions, selectedBranchCode]
  );
  const scopeLabel = useMemo(() => {
    if (selectedBranchCode) {
      return formatBranchLabel(selectedBranchCode, selectedBranch?.name);
    }
    if (isAdmin) {
      return "ทุกสาขา";
    }
    return userBranchCode ? formatBranchLabel(userBranchCode, "") : "ตามสิทธิ์ผู้ใช้";
  }, [isAdmin, selectedBranch?.name, selectedBranchCode, userBranchCode]);
  const totalLabel = selectedBranchCode || !isAdmin ? "คงเหลือรวมของสาขานี้" : "คงเหลือรวมทุกสาขา";
  const branchColumnLabel = selectedBranchCode || !isAdmin ? "สาขา" : "กระจายอยู่ในสาขา";
  const emptyStateText =
    selectedBranchCode || !isAdmin
      ? "สินค้านี้ยังไม่มี stock คงเหลือในสาขาที่เลือก"
      : "สินค้านี้ยังไม่มี stock คงเหลือในระบบตอนนี้";

  useEffect(() => {
    if (!productId) return;
    setSelectedBranchCode(isAdmin ? "" : userBranchCode);
    setRows([]);
    setStockError("");
    setBranchLoadError("");
  }, [isAdmin, productId, userBranchCode]);

  useEffect(() => {
    if (!productId || !isAdmin) {
      setBranchOptions([]);
      setIsLoadingBranches(false);
      setBranchLoadError("");
      return undefined;
    }

    let active = true;
    branchRequestSeqRef.current += 1;
    const requestSeq = branchRequestSeqRef.current;

    setIsLoadingBranches(true);
    setBranchLoadError("");

    void inventoryApi
      .listLocations({ includeInactive: false, locationType: "BRANCH" })
      .then((response) => {
        if (!active || requestSeq !== branchRequestSeqRef.current) return;
        setBranchOptions(normalizeLocationRows(response));
      })
      .catch((error) => {
        if (!active || requestSeq !== branchRequestSeqRef.current) return;
        setBranchOptions([]);
        setBranchLoadError(normalizeErrorText(error));
      })
      .finally(() => {
        if (active && requestSeq === branchRequestSeqRef.current) {
          setIsLoadingBranches(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isAdmin, productId]);

  useEffect(() => {
    if (!productId) return undefined;

    let active = true;
    stockRequestSeqRef.current += 1;
    const requestSeq = stockRequestSeqRef.current;

    setIsLoadingStock(true);
    setStockError("");

    void inventoryApi
      .listStockOnHand({
        productId,
        branchCode: selectedBranchCode || undefined,
      })
      .then((response) => {
        if (!active || requestSeq !== stockRequestSeqRef.current) return;
        const normalizedRows = normalizeStockOnHandRows(response).filter((row) => {
          return !row.productId || row.productId === productId;
        });
        setRows(normalizedRows);
      })
      .catch((error) => {
        if (!active || requestSeq !== stockRequestSeqRef.current) return;
        setRows([]);
        setStockError(normalizeErrorText(error));
      })
      .finally(() => {
        if (active && requestSeq === stockRequestSeqRef.current) {
          setIsLoadingStock(false);
        }
      });

    return () => {
      active = false;
    };
  }, [productId, selectedBranchCode]);

  useEffect(() => {
    if (!productId) return undefined;

    function handleWindowKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [onClose, productId]);

  if (!productId) {
    return null;
  }

  return (
    <div
      className="products-stock-modal-overlay"
      aria-hidden="false"
      role="dialog"
      aria-modal="true"
      aria-labelledby="products-stock-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div className="products-stock-modal">
        <div className="products-stock-modal__header">
          <div>
            <h2 id="products-stock-modal-title">สรุป stock ตาม lot</h2>
            <p>ดูยอดคงเหลือของสินค้าแบบแยก lot และเปลี่ยนขอบเขตสาขาได้ทันทีใน modal นี้</p>
          </div>
          <button type="button" className="products-btn secondary" onClick={() => onClose?.()}>
            ปิด
          </button>
        </div>

        <div className="products-stock-modal__top">
          <section className="products-stock-modal__product-panel">
            <div className="products-stock-modal__product-copy">
              <h3>{toCleanText(product?.tradeName) || "-"}</h3>
              <p>{toCleanText(product?.genericName) || "ไม่ระบุชื่อสามัญ"}</p>
            </div>

            <div className="products-stock-modal__meta-grid">
              <div>
                <strong>รหัสสินค้า</strong>
                <span>{toCleanText(product?.productCode) || "-"}</span>
              </div>
              <div>
                <strong>บาร์โค้ด</strong>
                <span>{toCleanText(product?.barcode) || "-"}</span>
              </div>
              <div>
                <strong>ผู้ผลิต/ผู้นำเข้า</strong>
                <span>{toCleanText(product?.manufacturerName) || "-"}</span>
              </div>
              <div>
                <strong>ชนิดรายงาน</strong>
                <span>
                  {Array.isArray(product?.reportGroupCodes) && product.reportGroupCodes.length
                    ? product.reportGroupCodes.join(", ")
                    : "-"}
                </span>
              </div>
              <div>
                <strong>รูปแบบยา</strong>
                <span>{toCleanText(product?.dosageFormCode) || "-"}</span>
              </div>
              <div>
                <strong>บรรจุภัณฑ์</strong>
                <span>{toCleanText(product?.packagingSummary || product?.packageSize) || "-"}</span>
              </div>
            </div>
          </section>

          <aside className="products-stock-modal__totals">
            {isAdmin ? (
              <label className="products-stock-modal__branch-field">
                <span>ขอบเขตสต๊อก</span>
                <select
                  value={selectedBranchCode}
                  onChange={(event) => setSelectedBranchCode(toCleanText(event.target.value))}
                  disabled={isLoadingBranches || isLoadingStock}
                >
                  <option value="">ทุกสาขา</option>
                  {branchOptions.map((branch) => (
                    <option key={branch.code} value={branch.code}>
                      {formatBranchLabel(branch.code, branch.name)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="products-stock-modal__scope-card">
                <span>ขอบเขตสต๊อก</span>
                <strong>{scopeLabel}</strong>
              </div>
            )}

            {branchLoadError ? (
              <div className="products-stock-modal__branch-error">{branchLoadError}</div>
            ) : null}

            <span className="products-stock-modal__totals-label">{totalLabel}</span>
            <strong>
              {isLoadingStock
                ? "กำลังโหลด..."
                : formatStockQuantityWithUnit(summary.totalQuantity, summary.totalUnitLabel)}
            </strong>

            <div className="products-stock-modal__totals-meta">
              <span>{scopeLabel}</span>
              <span>{summary.lotCount} lot</span>
              <span>{summary.branchCount} สาขาที่มี stock</span>
            </div>
          </aside>
        </div>

        <section className="products-stock-modal__body">
          <div className="products-stock-modal__body-header">
            <h3>รายการคงเหลือแยกตาม lot</h3>
            <p>
              {selectedBranchCode || !isAdmin
                ? "จำนวนด้านล่างเป็นยอดของ lot ภายในขอบเขตสาขาที่เลือก"
                : "จำนวนด้านล่างเป็นยอดรวมต่อ lot และระบุว่าสาขาไหนถือ stock อยู่บ้าง"}
            </p>
          </div>

          {isLoadingStock ? (
            <div className="products-stock-modal__empty">กำลังโหลด stock คงเหลือ...</div>
          ) : stockError ? (
            <div className="products-alert error">{stockError}</div>
          ) : summary.lots.length ? (
            <div className="products-stock-modal__table-wrap">
              <table className="products-stock-table">
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>วันหมดอายุ</th>
                    <th>คงเหลือรวม</th>
                    <th>{branchColumnLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.lots.map((lot) => (
                    <tr key={lot.key}>
                      <td>{lot.lotNo || "ไม่ระบุ lot"}</td>
                      <td>{formatDateOnlyDisplay(lot.expDate) || "-"}</td>
                      <td>{formatStockQuantityWithUnit(lot.quantity, lot.unitLabel)}</td>
                      <td>
                        {lot.branches.length ? (
                          <div className="products-stock-table__branches">
                            {lot.branches.map((branch) => (
                              <span
                                key={`${lot.key}-${branch.branchCode || branch.branchName || "branch"}`}
                                className="products-stock-table__branch-pill"
                              >
                                {formatBranchLabel(branch.branchCode, branch.branchName)}
                                {" • "}
                                {formatStockQuantityWithUnit(branch.quantity, lot.unitLabel)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="products-stock-modal__empty">{emptyStateText}</div>
          )}
        </section>
      </div>
    </div>
  );
}
