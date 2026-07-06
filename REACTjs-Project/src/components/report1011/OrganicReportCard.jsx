import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { inventoryApi, productsApi, reportsApi } from "../../lib/api";
import {
  buildOrganicBulkReportCsv,
  buildOrganicReportCsv,
} from "../../lib/report1011/exportOrganicCsv";
import {
  countOrganicReportLots,
  countOrganicReportRows,
  hasOrganicReportPages,
  normalizeOrganicReportCollection,
} from "../../lib/report1011/organicReportShape";
import Card from "./Card";
import FieldRow from "./FieldRow";
import OrganicBulkReportPreview from "./OrganicBulkReportPreview";
import OrganicReportPreview from "./OrganicReportPreview";

const ORGANIC_REPORT_MODES = [
  {
    value: "single",
    label: "single mode",
    description: "สร้างรายงานทีละสินค้าแบบเดิม",
  },
  {
    value: "bulk",
    label: "bulk mode",
    description: "สร้างรายงานการส่งมอบยาทีละหลายรายการในครั้งเดียว",
  },
];

function toCleanText(value) {
  return String(value || "").trim();
}

function toDateInputValue(date) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createInitialForm(user, isAdmin) {
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  return {
    branchCode: isAdmin ? "" : toCleanText(user?.branchCode || user?.branch_code),
    reportGroupCode: "KY11",
    productId: "",
    dateFrom: toDateInputValue(firstDayOfMonth),
    dateTo: toDateInputValue(now),
  };
}

function createInitialSingleReportData() {
  return {
    meta: null,
    pages: [],
    reports: [],
  };
}

function createInitialBulkReportData() {
  return {
    mode: "bulk",
    meta: null,
    items: [],
  };
}

function createInitialBulkRunState() {
  return {
    isRunning: false,
    isCancelling: false,
    processedCount: 0,
    totalCount: 0,
    currentProductId: "",
    currentProductName: "",
    startedAt: "",
    completedAt: "",
  };
}

function buildBulkReportMeta(form, counts = {}) {
  const requestedCount = Number(counts?.requestedCount) || 0;
  const successCount = Number(counts?.successCount) || 0;
  const failedCount = Number(counts?.failedCount) || 0;
  return {
    branchCode: toCleanText(form?.branchCode),
    reportGroupCode: toCleanText(form?.reportGroupCode).toUpperCase(),
    dateFrom: toCleanText(form?.dateFrom),
    dateTo: toCleanText(form?.dateTo),
    requestedCount,
    completedCount: successCount + failedCount,
    successCount,
    failedCount,
    cancelled: Boolean(counts?.cancelled),
    startedAt: toCleanText(counts?.startedAt),
    completedAt: toCleanText(counts?.completedAt),
  };
}

function downloadCsv({ filename, csvText }) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function normalizeProductOption(product) {
  const id = toCleanText(product?.id ?? product?.productId);
  const tradeName = toCleanText(product?.tradeName ?? product?.productName ?? product?.name) || "-";
  const productCode = toCleanText(product?.productCode ?? product?.code);
  const packageSize = toCleanText(
    product?.packageSize ?? product?.packagingSummary ?? product?.reportReceiveUnitLabel
  );
  const activityCount = Number(
    product?.activityCount ?? product?.dispenseCount ?? product?.rowCount ?? product?.count
  );
  const lotCount = Number(product?.lotCount ?? product?.lotsCount);

  return {
    id,
    tradeName,
    productCode,
    packageSize,
    label: `${tradeName} : ${packageSize || "-"}`,
    activityCount: Number.isFinite(activityCount) ? activityCount : null,
    lotCount: Number.isFinite(lotCount) ? lotCount : null,
    searchText: `${tradeName} ${productCode} ${packageSize}`.toLowerCase(),
  };
}

function normalizeActivityProductsResponse(response) {
  const rows = Array.isArray(response?.items)
    ? response.items
    : Array.isArray(response?.products)
      ? response.products
      : Array.isArray(response?.rows)
        ? response.rows
        : Array.isArray(response)
          ? response
          : [];

  return rows
    .map(normalizeProductOption)
    .filter((product) => product.id)
    .sort((left, right) => left.label.localeCompare(right.label, "th"));
}

function filterActivityProducts(products, searchTerm) {
  const normalizedTerm = toCleanText(searchTerm).toLowerCase();
  if (!normalizedTerm) return products;
  return products.filter((product) => product.searchText.includes(normalizedTerm));
}

function buildActivityProductStats(product) {
  const parts = [];

  if (product?.productCode) {
    parts.push(product.productCode);
  }
  if (product?.packageSize) {
    parts.push(product.packageSize);
  }
  if (Number.isFinite(product?.activityCount) && product.activityCount > 0) {
    parts.push(`dispense ${product.activityCount.toLocaleString("th-TH")} รายการ`);
  }
  if (Number.isFinite(product?.lotCount) && product.lotCount > 0) {
    parts.push(`${product.lotCount.toLocaleString("th-TH")} lot`);
  }

  return parts.join(" • ");
}

function buildBulkItemStatusText(item) {
  if (!item) return "-";
  if (item.status === "error") {
    return item.errorMessage || "สร้างรายงานไม่สำเร็จ";
  }
  if (!item.rowCount) {
    return "เรียกข้อมูลสำเร็จ แต่ยังไม่พบรายการจ่ายจริงในเงื่อนไขนี้";
  }
  return `${item.rowCount.toLocaleString("th-TH")} รายการจ่าย • ${item.lotCount.toLocaleString(
    "th-TH"
  )} lot`;
}

function OrganicReportModeSwitch({ reportMode, onChange }) {
  return (
    <div className="organic-report-card__mode">
      <span className="organic-report-card__mode-label">โหมดการสร้างรายงาน</span>
      <div className="organic-report-mode-switch" role="tablist" aria-label="Organic report mode">
        {ORGANIC_REPORT_MODES.map((option) => {
          const isActive = reportMode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-pressed={isActive}
              className={`organic-report-mode-switch__button${
                isActive ? " organic-report-mode-switch__button--active" : ""
              }`}
              onClick={() => onChange(option.value)}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OrganicReportBulkSelector({
  activityProducts,
  visibleActivityProducts,
  activityLoading,
  activityError,
  selectionDisabled,
  hasLoadedActivityProducts,
  selectedProductIds,
  selectedProductIdSet,
  bulkSearchTerm,
  onSearchChange,
  onToggleProduct,
  onSelectAllVisible,
  onClearAll,
}) {
  const visibleCount = visibleActivityProducts.length;
  const totalCount = activityProducts.length;
  const selectedCount = selectedProductIds.length;
  const hasResults = totalCount > 0;

  return (
    <div className="organic-report-bulk">
      <div className="organic-report-bulk__intro">
        <strong>เลือกหลายสินค้าในรอบเดียว</strong>
        <span>ใช้ branch / กลุ่มรายงาน / ช่วงวันที่ด้านบนเป็นเงื่อนไขค้นหา</span>
      </div>

      {activityError ? <div className="lot-warning organic-report-warning">{activityError}</div> : null}

      {!activityLoading && !hasLoadedActivityProducts ? (
        <div className="organic-report-card__empty organic-report-card__empty--compact">
          กดปุ่ม “ค้นหารายการสินค้าที่มีการเคลื่อนไหวจริง” เพื่อโหลดรายการสินค้าที่มี dispense จริงตามเงื่อนไขที่เลือก
        </div>
      ) : null}

      {activityLoading ? (
        <div className="organic-report-card__summary organic-report-card__summary--compact">
          กำลังค้นหารายการสินค้าที่มีการเคลื่อนไหวจริง...
        </div>
      ) : null}

      {hasLoadedActivityProducts && !activityLoading && !hasResults ? (
        <div className="organic-report-card__empty organic-report-card__empty--compact">
          ไม่พบสินค้าที่มี dispense จริงตามเงื่อนไขที่เลือก
        </div>
      ) : null}

      {hasResults ? (
        <>
          <div className="organic-report-bulk__controls">
            <input
              id="organic-bulk-search"
              className="organic-report-bulk__search"
              type="search"
              value={bulkSearchTerm}
              onChange={(event) => onSearchChange(event.target.value)}
              disabled={selectionDisabled}
              placeholder="ค้นหาตามชื่อสินค้า / รหัสสินค้า"
            />
            <div className="organic-report-bulk__actions">
              <button
                className="ghost-button"
                type="button"
                onClick={onSelectAllVisible}
                disabled={selectionDisabled || !visibleCount}
              >
                Select all
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={onClearAll}
                disabled={selectionDisabled || !selectedCount}
              >
                Clear all
              </button>
            </div>
          </div>

          <div className="organic-report-bulk__summary">
            <span>
              เลือกแล้ว {selectedCount.toLocaleString("th-TH")} / {totalCount.toLocaleString("th-TH")} รายการ
            </span>
            <span>
              {bulkSearchTerm
                ? `กำลังแสดง ${visibleCount.toLocaleString("th-TH")} รายการที่ตรงกับคำค้น`
                : `รายการที่พบ ${totalCount.toLocaleString("th-TH")} รายการ`}
            </span>
          </div>

          {visibleCount ? (
            <div className="organic-report-bulk__list" role="list">
              {visibleActivityProducts.map((product) => {
                const isSelected = selectedProductIdSet.has(product.id);
                return (
                  <label
                    key={product.id}
                    className={`organic-report-bulk__item${isSelected ? " is-selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={selectionDisabled}
                      onChange={() => onToggleProduct(product.id)}
                    />
                    <div className="organic-report-bulk__item-copy">
                      <strong>{product.tradeName}</strong>
                      <span>{buildActivityProductStats(product) || "-"}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="organic-report-card__empty organic-report-card__empty--compact">
              ไม่พบรายการสินค้าที่ตรงกับคำค้นปัจจุบัน
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function OrganicReportBulkRunPanel({ bulkReportData, bulkRunState, bulkGenerateError }) {
  const meta = bulkReportData?.meta;
  const items = Array.isArray(bulkReportData?.items) ? bulkReportData.items : [];
  const failedItems = items.filter((item) => item.status === "error");
  const hasRunOutput = Boolean(meta) || Boolean(items.length);

  if (!bulkGenerateError && !bulkRunState.isRunning && !hasRunOutput) {
    return null;
  }

  return (
    <div className="organic-report-bulk-run">
      <div className="organic-report-bulk-run__header">
        <div>
          <strong>สถานะการสร้างรายงานแบบหลายสินค้า</strong>
          <span>
            {bulkRunState.isRunning
              ? `กำลังประมวลผล ${bulkRunState.processedCount.toLocaleString("th-TH")} / ${bulkRunState.totalCount.toLocaleString(
                  "th-TH"
                )}`
              : meta
                ? `ประมวลผลแล้ว ${meta.completedCount.toLocaleString("th-TH")} / ${meta.requestedCount.toLocaleString(
                    "th-TH"
                  )}`
                : "ยังไม่มีผลลัพธ์การสร้างรายงานแบบหลายสินค้า"}
          </span>
        </div>
        {bulkRunState.isRunning && bulkRunState.currentProductName ? (
          <div className="organic-report-bulk-run__pill">
            กำลังสร้าง: {bulkRunState.currentProductName}
          </div>
        ) : null}
      </div>

      {bulkGenerateError ? <div className="lot-warning organic-report-warning">{bulkGenerateError}</div> : null}

      {meta ? (
        <div className="organic-report-bulk-run__summary">
          <span>เลือกไว้ {meta.requestedCount.toLocaleString("th-TH")} รายการ</span>
          <span>สำเร็จ {meta.successCount.toLocaleString("th-TH")} รายการ</span>
          <span>ไม่สำเร็จ {meta.failedCount.toLocaleString("th-TH")} รายการ</span>
          {meta.cancelled ? <span>สถานะ: ยกเลิกโดยผู้ใช้</span> : null}
        </div>
      ) : null}

      {!bulkRunState.isRunning && meta?.failedCount ? (
        <div className="lot-warning organic-report-warning">
          พบ partial failures ระหว่าง bulk run ระบบข้ามรายการที่ไม่สำเร็จและเก็บผลรายการที่สำเร็จไว้แล้ว
        </div>
      ) : null}

      {items.length ? (
        <div className="organic-report-bulk-run__list" role="list">
          {items.map((item) => (
            <div
              key={`${item.productId}-${item.status}`}
              role="listitem"
              className={`organic-report-bulk-run__item organic-report-bulk-run__item--${item.status}`}
            >
              <div className="organic-report-bulk-run__item-copy">
                <strong>{item.productName || item.productId}</strong>
                <span>{[item.productCode, buildBulkItemStatusText(item)].filter(Boolean).join(" • ")}</span>
              </div>
              <span className="organic-report-bulk-run__item-status">
                {item.status === "success" ? "success" : "error"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {!bulkRunState.isRunning && failedItems.length ? (
        <div className="organic-report-card__meta organic-report-card__meta--stacked">
          {failedItems.map((item) => (
            <span key={`${item.productId}-failure`}>
              {item.productName || item.productId}: {item.errorMessage || "สร้างรายงานไม่สำเร็จ"}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function OrganicReportCard({ onPrint }) {
  const { user } = useAuth();
  const userRole = toCleanText(user?.role).toUpperCase();
  const isAdmin = userRole === "ADMIN";
  const isMountedRef = useRef(true);
  const activityRequestSeqRef = useRef(0);
  const bulkRunSeqRef = useRef(0);
  const bulkCancelRequestedRef = useRef(false);

  const [form, setForm] = useState(() => createInitialForm(user, isAdmin));
  const [reportMode, setReportMode] = useState("single");
  const [branchOptions, setBranchOptions] = useState([]);
  const [reportGroups, setReportGroups] = useState([]);
  const [products, setProducts] = useState([]);
  const [catalogError, setCatalogError] = useState("");
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isGeneratingSingle, setIsGeneratingSingle] = useState(false);
  const [singleGenerateError, setSingleGenerateError] = useState("");
  const [singleEmptyStateText, setSingleEmptyStateText] = useState("");
  const [singleReportData, setSingleReportData] = useState(() => createInitialSingleReportData());
  const [activityProducts, setActivityProducts] = useState([]);
  const [hasLoadedActivityProducts, setHasLoadedActivityProducts] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [bulkSearchTerm, setBulkSearchTerm] = useState("");
  const [bulkGenerateError, setBulkGenerateError] = useState("");
  const [bulkReportData, setBulkReportData] = useState(() => createInitialBulkReportData());
  const [bulkRunState, setBulkRunState] = useState(() => createInitialBulkRunState());

  const isBulkMode = reportMode === "bulk";

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      activityRequestSeqRef.current += 1;
      bulkRunSeqRef.current += 1;
      bulkCancelRequestedRef.current = true;
    };
  }, []);

  useEffect(() => {
    setForm((prev) => {
      const nextBranchCode = isAdmin ? prev.branchCode : toCleanText(user?.branchCode || user?.branch_code);
      return {
        ...prev,
        branchCode: nextBranchCode,
      };
    });
  }, [isAdmin, user?.branchCode, user?.branch_code]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingCatalog(true);
    setCatalogError("");

    Promise.all([
      inventoryApi.listLocations({ locationType: "BRANCH" }),
      productsApi.reportGroups(),
      productsApi.list(""),
    ])
      .then(([locations, groups, productRows]) => {
        if (cancelled) return;
        setBranchOptions(Array.isArray(locations) ? locations : []);
        setReportGroups(Array.isArray(groups) ? groups : []);
        setProducts(Array.isArray(productRows) ? productRows : []);
      })
      .catch((error) => {
        if (cancelled) return;
        setBranchOptions([]);
        setReportGroups([]);
        setProducts([]);
        setCatalogError(error?.message || "โหลดข้อมูลรายงานไม่สำเร็จ");
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingCatalog(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredReportGroups = useMemo(() => {
    return reportGroups
      .filter((group) => ["KY10", "KY11"].includes(toCleanText(group?.code).toUpperCase()))
      .sort((left, right) => toCleanText(left?.code).localeCompare(toCleanText(right?.code), "th"));
  }, [reportGroups]);

  const productOptions = useMemo(() => {
    const targetGroup = toCleanText(form.reportGroupCode).toUpperCase();
    if (!targetGroup) return [];

    return products
      .filter((product) =>
        Array.isArray(product?.reportGroupCodes) &&
        product.reportGroupCodes.some((code) => toCleanText(code).toUpperCase() === targetGroup)
      )
      .map(normalizeProductOption)
      .filter((product) => product.id)
      .sort((left, right) => left.label.localeCompare(right.label, "th"));
  }, [form.reportGroupCode, products]);

  const selectedBranchLabel = useMemo(() => {
    const targetBranchCode = toCleanText(form.branchCode);
    const branch = branchOptions.find((option) => toCleanText(option?.code) === targetBranchCode);
    if (!branch) {
      return targetBranchCode ? `${targetBranchCode} : สาขาไม่อยู่ในรายการ` : "";
    }
    return `${toCleanText(branch.code)} : ${toCleanText(branch.name) || "-"}`;
  }, [branchOptions, form.branchCode]);

  const selectedProductLabel = useMemo(() => {
    return productOptions.find((product) => product.id === form.productId)?.label || "";
  }, [form.productId, productOptions]);

  const visibleActivityProducts = useMemo(
    () => filterActivityProducts(activityProducts, bulkSearchTerm),
    [activityProducts, bulkSearchTerm]
  );

  const selectedProductIdSet = useMemo(() => new Set(selectedProductIds), [selectedProductIds]);
  const activityProductsById = useMemo(
    () => new Map(activityProducts.map((product) => [product.id, product])),
    [activityProducts]
  );
  const bulkSuccessfulItems = useMemo(() => {
    const items = Array.isArray(bulkReportData?.items) ? bulkReportData.items : [];
    return items.filter(
        (item) =>
        item?.status === "success" &&
        hasOrganicReportPages(item?.reportData)
    );
  }, [bulkReportData?.items]);
  const hasBulkSuccessfulReports = bulkSuccessfulItems.length > 0;

  const organicSummaryText = useMemo(() => {
    const lotCount = countOrganicReportLots(singleReportData);
    const rowCount = countOrganicReportRows(singleReportData);

    if (!lotCount || !rowCount) return "";
    return `พบ ${rowCount.toLocaleString("th-TH")} รายการจ่าย ครอบคลุม ${lotCount.toLocaleString(
      "th-TH"
    )} lot`;
  }, [singleReportData]);

  useEffect(() => {
    if (!form.productId) return;
    if (productOptions.some((product) => product.id === form.productId)) return;
    setForm((prev) => ({
      ...prev,
      productId: "",
    }));
  }, [form.productId, productOptions]);

  useEffect(() => {
    activityRequestSeqRef.current += 1;
    bulkRunSeqRef.current += 1;
    bulkCancelRequestedRef.current = false;
    setActivityProducts([]);
    setHasLoadedActivityProducts(false);
    setActivityLoading(false);
    setActivityError("");
    setSelectedProductIds([]);
    setBulkSearchTerm("");
    setBulkGenerateError("");
    setBulkReportData(createInitialBulkReportData());
    setBulkRunState(createInitialBulkRunState());
  }, [form.branchCode, form.reportGroupCode, form.dateFrom, form.dateTo]);

  useEffect(() => {
    setSingleGenerateError("");
    setSingleEmptyStateText("");
    setSingleReportData(createInitialSingleReportData());
  }, [reportMode]);

  const handleFieldChange = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
      ...(field === "reportGroupCode" ? { productId: "" } : {}),
    }));
    setSingleGenerateError("");
    setSingleEmptyStateText("");
    setSingleReportData(createInitialSingleReportData());
  };

  const handleReportModeChange = (nextMode) => {
    if (!nextMode || nextMode === reportMode) return;
    if (reportMode === "bulk" && bulkRunState.isRunning) {
      bulkRunSeqRef.current += 1;
      bulkCancelRequestedRef.current = true;
      setBulkRunState(createInitialBulkRunState());
    }
    setReportMode(nextMode);
  };

  const handleGenerate = async () => {
    if (!form.branchCode) {
      setSingleGenerateError("กรุณาเลือกสาขา");
      return;
    }
    if (!form.reportGroupCode) {
      setSingleGenerateError("กรุณาเลือกกลุ่มรายงาน");
      return;
    }
    if (!form.productId) {
      setSingleGenerateError("กรุณาเลือกสินค้า");
      return;
    }

    setIsGeneratingSingle(true);
    setSingleGenerateError("");
    setSingleEmptyStateText("");

    try {
      const payload = await reportsApi.organicDispenseLedger({
        branchCode: form.branchCode,
        reportGroupCode: form.reportGroupCode,
        productId: form.productId,
        dateFrom: form.dateFrom,
        dateTo: form.dateTo,
      });

      const nextReportData = normalizeOrganicReportCollection(payload);
      setSingleReportData(nextReportData);

      if (!countOrganicReportRows(nextReportData)) {
        setSingleEmptyStateText("ยังไม่พบข้อมูลการจ่ายยาจริงตามเงื่อนไขที่เลือก");
      }
    } catch (error) {
      setSingleReportData(createInitialSingleReportData());
      setSingleGenerateError(error?.message || "สร้างรายงานจากข้อมูลจริงไม่สำเร็จ");
    } finally {
      setIsGeneratingSingle(false);
    }
  };

  const handleLoadActivityProducts = async () => {
    if (!form.branchCode) {
      setActivityError("กรุณาเลือกสาขาก่อนค้นหารายการสินค้า");
      return;
    }
    if (!form.reportGroupCode) {
      setActivityError("กรุณาเลือกกลุ่มรายงานก่อนค้นหารายการสินค้า");
      return;
    }

    const requestSeq = activityRequestSeqRef.current + 1;
    activityRequestSeqRef.current = requestSeq;
    setActivityLoading(true);
    setActivityError("");
    setHasLoadedActivityProducts(false);
    setBulkGenerateError("");
    setBulkReportData(createInitialBulkReportData());
    setBulkRunState(createInitialBulkRunState());

    try {
      const payload = await reportsApi.organicDispenseLedgerActivityProducts({
        branchCode: form.branchCode,
        reportGroupCode: form.reportGroupCode,
        dateFrom: form.dateFrom,
        dateTo: form.dateTo,
      });

      if (activityRequestSeqRef.current !== requestSeq) {
        return;
      }

      const nextProducts = normalizeActivityProductsResponse(payload);
      setActivityProducts(nextProducts);
      setSelectedProductIds([]);
      setHasLoadedActivityProducts(true);
    } catch (error) {
      if (activityRequestSeqRef.current !== requestSeq) {
        return;
      }

      setActivityProducts([]);
      setSelectedProductIds([]);
      setHasLoadedActivityProducts(false);
      setActivityError(error?.message || "โหลดรายการสินค้าที่มีการเคลื่อนไหวจริงไม่สำเร็จ");
    } finally {
      if (activityRequestSeqRef.current === requestSeq) {
        setActivityLoading(false);
      }
    }
  };

  const handleBulkGenerate = async () => {
    if (!form.branchCode) {
      setBulkGenerateError("กรุณาเลือกสาขา");
      return;
    }
    if (!form.reportGroupCode) {
      setBulkGenerateError("กรุณาเลือกกลุ่มรายงาน");
      return;
    }
    if (!form.dateFrom || !form.dateTo) {
      setBulkGenerateError("กรุณาระบุช่วงวันที่ขายให้ครบ");
      return;
    }
    if (!selectedProductIds.length) {
      setBulkGenerateError("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ");
      return;
    }

    const selectedProducts = selectedProductIds.map((productId) => {
      const matched = activityProductsById.get(productId);
      return {
        id: productId,
        tradeName: matched?.tradeName || productId,
        productCode: matched?.productCode || "",
      };
    });

    const requestedCount = selectedProducts.length;
    const startedAt = new Date().toISOString();
    const runSeq = bulkRunSeqRef.current + 1;
    bulkRunSeqRef.current = runSeq;
    bulkCancelRequestedRef.current = false;

    setBulkGenerateError("");
    setBulkReportData({
      mode: "bulk",
      meta: buildBulkReportMeta(form, {
        requestedCount,
        successCount: 0,
        failedCount: 0,
        startedAt,
      }),
      items: [],
    });
    setBulkRunState({
      isRunning: true,
      isCancelling: false,
      processedCount: 0,
      totalCount: requestedCount,
      currentProductId: "",
      currentProductName: "",
      startedAt,
      completedAt: "",
    });

    const collectedItems = [];
    let successCount = 0;
    let failedCount = 0;
    let processedCount = 0;

    for (const product of selectedProducts) {
      if (!isMountedRef.current || bulkRunSeqRef.current !== runSeq || bulkCancelRequestedRef.current) {
        break;
      }

      setBulkRunState((prev) => ({
        ...prev,
        isRunning: true,
        currentProductId: product.id,
        currentProductName: product.tradeName,
        processedCount,
        totalCount: requestedCount,
      }));

      try {
        const payload = await reportsApi.organicDispenseLedger({
          branchCode: form.branchCode,
          reportGroupCode: form.reportGroupCode,
          productId: product.id,
          dateFrom: form.dateFrom,
          dateTo: form.dateTo,
        });

        if (!isMountedRef.current || bulkRunSeqRef.current !== runSeq || bulkCancelRequestedRef.current) {
          break;
        }

        successCount += 1;
        const normalizedReportData = normalizeOrganicReportCollection(payload);
        collectedItems.push({
          productId: product.id,
          productName: product.tradeName,
          productCode: product.productCode,
          status: "success",
          rowCount: countOrganicReportRows(normalizedReportData),
          lotCount: countOrganicReportLots(normalizedReportData),
          reportData: normalizedReportData,
        });
      } catch (error) {
        if (!isMountedRef.current || bulkRunSeqRef.current !== runSeq || bulkCancelRequestedRef.current) {
          break;
        }

        failedCount += 1;
        collectedItems.push({
          productId: product.id,
          productName: product.tradeName,
          productCode: product.productCode,
          status: "error",
          errorMessage: error?.message || "สร้างรายงานจากข้อมูลจริงไม่สำเร็จ",
        });
      }

      processedCount += 1;

      if (!isMountedRef.current || bulkRunSeqRef.current !== runSeq) {
        return;
      }

      setBulkReportData({
        mode: "bulk",
        meta: buildBulkReportMeta(form, {
          requestedCount,
          successCount,
          failedCount,
          startedAt,
        }),
        items: [...collectedItems],
      });
      setBulkRunState((prev) => ({
        ...prev,
        processedCount,
        totalCount: requestedCount,
      }));
    }

    if (!isMountedRef.current || bulkRunSeqRef.current !== runSeq) {
      return;
    }

    const completedAt = new Date().toISOString();
    const cancelled = bulkCancelRequestedRef.current;

    setBulkReportData({
      mode: "bulk",
      meta: buildBulkReportMeta(form, {
        requestedCount,
        successCount,
        failedCount,
        cancelled,
        startedAt,
        completedAt,
      }),
      items: [...collectedItems],
    });
    setBulkRunState({
      isRunning: false,
      isCancelling: false,
      processedCount: processedCount,
      totalCount: requestedCount,
      currentProductId: "",
      currentProductName: "",
      startedAt,
      completedAt,
    });
    bulkCancelRequestedRef.current = false;
  };

  const handleCancelBulkRun = () => {
    if (!bulkRunState.isRunning) return;
    bulkCancelRequestedRef.current = true;
    setBulkRunState((prev) => ({
      ...prev,
      isCancelling: true,
    }));
  };

  const handleToggleBulkProduct = (productId) => {
    const normalizedProductId = toCleanText(productId);
    if (!normalizedProductId) return;

    setSelectedProductIds((prev) =>
      prev.includes(normalizedProductId)
        ? prev.filter((id) => id !== normalizedProductId)
        : [...prev, normalizedProductId]
    );
  };

  const handleSelectAllVisibleProducts = () => {
    const nextIds = visibleActivityProducts.map((product) => product.id).filter(Boolean);
    setSelectedProductIds((prev) => [...new Set([...prev, ...nextIds])]);
  };

  const handleClearAllBulkProducts = () => {
    setSelectedProductIds([]);
  };

  const handleDownload = () => {
    if (isBulkMode) {
      if (!hasBulkSuccessfulReports) return;
      downloadCsv(buildOrganicBulkReportCsv(bulkReportData));
      return;
    }

    if (!hasOrganicReportPages(singleReportData)) return;
    downloadCsv(buildOrganicReportCsv(singleReportData));
  };

  return (
    <>
      <Card title="รายงานจากข้อมูลจริง" className="organic-report-card no-print">
        <p className="organic-report-card__intro">
          ปริ้นท์ข้อมูลการส่งมอบยาขย.10 และ ขย.11 ที่นี่
        </p>

        <OrganicReportModeSwitch reportMode={reportMode} onChange={handleReportModeChange} />

        <div className="form-grid organic-report-grid">
          <FieldRow
            label="สาขา"
            htmlFor="organic-branch"
            className="organic-report-grid__row organic-report-grid__row--branch"
          >
            {isAdmin ? (
              <select
                id="organic-branch"
                value={form.branchCode}
                onChange={(event) => handleFieldChange("branchCode", event.target.value)}
                disabled={isLoadingCatalog}
              >
                <option value="">เลือกสาขา…</option>
                {branchOptions.map((branch) => (
                  <option key={branch.id || branch.code} value={branch.code}>
                    {`${toCleanText(branch.code)} : ${toCleanText(branch.name) || "-"}`}
                  </option>
                ))}
              </select>
            ) : (
              <input id="organic-branch" type="text" readOnly value={selectedBranchLabel} />
            )}
          </FieldRow>

          <FieldRow
            label="กลุ่มรายงาน"
            htmlFor="organic-report-group"
            className="organic-report-grid__row organic-report-grid__row--group"
          >
            <select
              id="organic-report-group"
              value={form.reportGroupCode}
              onChange={(event) => handleFieldChange("reportGroupCode", event.target.value)}
              disabled={isLoadingCatalog}
            >
              <option value="">เลือกกลุ่มรายงาน…</option>
              {filteredReportGroups.map((group) => (
                <option key={group.code} value={group.code}>
                  {`${toCleanText(group.code)} : ${toCleanText(group.thaiName) || "-"}`}
                </option>
              ))}
            </select>
          </FieldRow>

          <FieldRow
            label="สินค้า"
            htmlFor={isBulkMode ? "organic-bulk-search" : "organic-product"}
            className="organic-report-grid__row organic-report-grid__row--product"
          >
            {isBulkMode ? (
              <OrganicReportBulkSelector
                activityProducts={activityProducts}
                visibleActivityProducts={visibleActivityProducts}
                activityLoading={activityLoading}
                activityError={activityError}
                selectionDisabled={bulkRunState.isRunning}
                hasLoadedActivityProducts={hasLoadedActivityProducts}
                selectedProductIds={selectedProductIds}
                selectedProductIdSet={selectedProductIdSet}
                bulkSearchTerm={bulkSearchTerm}
                onSearchChange={setBulkSearchTerm}
                onToggleProduct={handleToggleBulkProduct}
                onSelectAllVisible={handleSelectAllVisibleProducts}
                onClearAll={handleClearAllBulkProducts}
              />
            ) : (
              <select
                id="organic-product"
                value={form.productId}
                onChange={(event) => handleFieldChange("productId", event.target.value)}
                disabled={isLoadingCatalog || !form.reportGroupCode || !productOptions.length}
              >
                <option value="" disabled>
                  {!form.reportGroupCode
                    ? "เลือกกลุ่มรายงานก่อน"
                    : productOptions.length
                      ? "เลือกสินค้า"
                      : "— ไม่มีรายการ —"}
                </option>
                {productOptions.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.label}
                  </option>
                ))}
              </select>
            )}
          </FieldRow>

          <FieldRow
            label="จากวันที่ขาย"
            htmlFor="organic-date-from"
            className="organic-report-grid__row organic-report-grid__row--date-from"
          >
            <input
              id="organic-date-from"
              type="date"
              value={form.dateFrom}
              onChange={(event) => handleFieldChange("dateFrom", event.target.value)}
            />
          </FieldRow>

          <FieldRow
            label="ถึงวันที่ขาย"
            htmlFor="organic-date-to"
            className="organic-report-grid__row organic-report-grid__row--date-to"
          >
            <input
              id="organic-date-to"
              type="date"
              value={form.dateTo}
              onChange={(event) => handleFieldChange("dateTo", event.target.value)}
            />
          </FieldRow>
        </div>

        {!isBulkMode && selectedProductLabel ? (
          <div className="organic-report-card__hint">
            <strong>สินค้าที่เลือก</strong>
            <span>{selectedProductLabel}</span>
          </div>
        ) : null}

        {isBulkMode ? (
          <div className="organic-report-card__hint">
            <strong>Bulk mode</strong>
            <span>
              โหมดนี้จะเรียก single-report endpoint ทีละสินค้าแบบ sequential จากฝั่ง frontend เพื่อคง
              generator เดิมไว้และลดความเสี่ยงการเปลี่ยน backend เชิงลึก
            </span>
          </div>
        ) : null}

        {catalogError ? <div className="lot-warning organic-report-warning">{catalogError}</div> : null}
        {!isBulkMode && singleGenerateError ? (
          <div className="lot-warning organic-report-warning">{singleGenerateError}</div>
        ) : null}
        {!isBulkMode && singleEmptyStateText ? (
          <div className="organic-report-card__empty">{singleEmptyStateText}</div>
        ) : null}
        {!isBulkMode && organicSummaryText ? (
          <div className="organic-report-card__summary">{organicSummaryText}</div>
        ) : null}
        {isBulkMode ? (
          <OrganicReportBulkRunPanel
            bulkReportData={bulkReportData}
            bulkRunState={bulkRunState}
            bulkGenerateError={bulkGenerateError}
          />
        ) : null}

        <div className="organic-report-card__actions">
          {isBulkMode ? (
            <>
              <button
                className="primary-button"
                type="button"
                disabled={
                  isLoadingCatalog ||
                  activityLoading ||
                  bulkRunState.isRunning ||
                  !selectedProductIds.length
                }
                onClick={handleBulkGenerate}
              >
                {bulkRunState.isRunning
                  ? `กำลังสร้าง ${bulkRunState.processedCount.toLocaleString("th-TH")} / ${bulkRunState.totalCount.toLocaleString("th-TH")}`
                  : "สร้างรายงานสินค้าที่เลือก"}
              </button>
              <button
                className="outline-button"
                type="button"
                disabled={isLoadingCatalog || activityLoading || bulkRunState.isRunning}
                onClick={handleLoadActivityProducts}
              >
                {activityLoading ? "กำลังค้นหารายการ..." : "ค้นหารายการสินค้าที่มีการเคลื่อนไหวจริง"}
              </button>
              {bulkRunState.isRunning ? (
                <button className="ghost-button" type="button" onClick={handleCancelBulkRun}>
                  {bulkRunState.isCancelling ? "กำลังยกเลิก..." : "ยกเลิกการสร้าง"}
                </button>
              ) : null}
            </>
          ) : (
            <button
              className="primary-button"
              type="button"
              disabled={isLoadingCatalog || isGeneratingSingle || activityLoading}
              onClick={handleGenerate}
            >
              {isGeneratingSingle ? "กำลังสร้างรายงาน..." : "สร้างรายงานจากข้อมูลจริง"}
            </button>
          )}
          <button
            className="outline-button"
            type="button"
            onClick={() => onPrint?.()}
            disabled={
              isBulkMode
                ? !hasBulkSuccessfulReports
                : !hasOrganicReportPages(singleReportData)
            }
          >
            พิมพ์รายงานจริง
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={handleDownload}
            disabled={
              isBulkMode
                ? !hasBulkSuccessfulReports
                : !hasOrganicReportPages(singleReportData)
            }
          >
            ดาวน์โหลด CSV จริง
          </button>
        </div>

        <div className="organic-report-card__meta">
          <span>สาขาผู้ใช้ทั่วไปถูกล็อกตาม account โดย backend</span>
          <span>admin เลือกสาขาได้ แต่รายงานยังอิง dispense จริงเท่านั้น</span>
          {isBulkMode ? (
            <span>เมื่อเปลี่ยนสาขา กลุ่มรายงาน หรือช่วงวันที่ ระบบจะล้างรายการ bulk และการเลือกเดิมทันที</span>
          ) : null}
        </div>
      </Card>

      {!isBulkMode ? (
        <OrganicReportPreview
          reportData={singleReportData}
          printTarget="organic"
        />
      ) : hasBulkSuccessfulReports ? (
        <OrganicBulkReportPreview bulkReportData={bulkReportData} printTarget="organic" />
      ) : null}
    </>
  );
}
