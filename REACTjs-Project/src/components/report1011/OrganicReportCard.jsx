import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { inventoryApi, productsApi, reportsApi } from "../../lib/api";
import { buildOrganicReportCsv } from "../../lib/report1011/exportOrganicCsv";
import Card from "./Card";
import FieldRow from "./FieldRow";
import OrganicReportPreview from "./OrganicReportPreview";

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

export default function OrganicReportCard({ onPrint }) {
  const { user } = useAuth();
  const userRole = toCleanText(user?.role).toUpperCase();
  const isAdmin = userRole === "ADMIN";

  const [form, setForm] = useState(() => createInitialForm(user, isAdmin));
  const [branchOptions, setBranchOptions] = useState([]);
  const [reportGroups, setReportGroups] = useState([]);
  const [products, setProducts] = useState([]);
  const [catalogError, setCatalogError] = useState("");
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [emptyStateText, setEmptyStateText] = useState("");
  const [reportData, setReportData] = useState(() => ({
    meta: null,
    pages: [],
  }));

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
      .map((product) => ({
        id: toCleanText(product?.id),
        label: `${toCleanText(product?.tradeName) || "-"} : ${
          toCleanText(product?.packageSize || product?.packagingSummary) || "-"
        }`,
        tradeName: toCleanText(product?.tradeName) || "-",
        productCode: toCleanText(product?.productCode) || "",
      }))
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

  useEffect(() => {
    if (!form.productId) return;
    if (productOptions.some((product) => product.id === form.productId)) return;
    setForm((prev) => ({
      ...prev,
      productId: "",
    }));
  }, [form.productId, productOptions]);

  const organicSummaryText = useMemo(() => {
    const pages = Array.isArray(reportData.pages) ? reportData.pages : [];
    const lotCount = pages.length;
    const rowCount = pages.reduce(
      (sum, page) => sum + (Array.isArray(page?.rows) ? page.rows.length : 0),
      0
    );

    if (!lotCount || !rowCount) return "";
    return `พบ ${rowCount.toLocaleString("th-TH")} รายการจ่าย ครอบคลุม ${lotCount.toLocaleString(
      "th-TH"
    )} lot`;
  }, [reportData.pages]);

  const handleFieldChange = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
      ...(field === "reportGroupCode" ? { productId: "" } : {}),
    }));
    setGenerateError("");
    setEmptyStateText("");
    setReportData({
      meta: null,
      pages: [],
    });
  };

  const handleGenerate = async () => {
    if (!form.branchCode) {
      setGenerateError("กรุณาเลือกสาขา");
      return;
    }
    if (!form.reportGroupCode) {
      setGenerateError("กรุณาเลือกกลุ่มรายงาน");
      return;
    }
    if (!form.productId) {
      setGenerateError("กรุณาเลือกสินค้า");
      return;
    }

    setIsGenerating(true);
    setGenerateError("");
    setEmptyStateText("");

    try {
      const payload = await reportsApi.organicDispenseLedger({
        branchCode: form.branchCode,
        reportGroupCode: form.reportGroupCode,
        productId: form.productId,
        dateFrom: form.dateFrom,
        dateTo: form.dateTo,
      });

      const nextPages = Array.isArray(payload?.pages) ? payload.pages : [];
      const nextMeta = payload?.meta || null;
      setReportData({
        meta: nextMeta,
        pages: nextPages,
      });

      if (!nextPages.length) {
        setEmptyStateText("ยังไม่พบข้อมูลการจ่ายยาจริงตามเงื่อนไขที่เลือก");
      }
    } catch (error) {
      setReportData({
        meta: null,
        pages: [],
      });
      setGenerateError(error?.message || "สร้างรายงานจากข้อมูลจริงไม่สำเร็จ");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!reportData.meta || !reportData.pages.length) return;
    downloadCsv(buildOrganicReportCsv(reportData));
  };

  return (
    <>
      <Card title="รายงานจากข้อมูลจริง" className="organic-report-card no-print">
        <p className="organic-report-card__intro">
          Card B นี้ใช้ข้อมูลจากธุรกรรมจริงของระบบ โดยดึงการจ่ายจาก Deliver/dispense และผูก lot กับ
          receive movement ย้อนหลังเพื่อเติมข้อมูลหัวเอกสารให้ใกล้ความจริงที่สุด โดยไม่แตะ generator
          แบบ make data เดิม
        </p>

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
            htmlFor="organic-product"
            className="organic-report-grid__row organic-report-grid__row--product"
          >
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

        {selectedProductLabel ? (
          <div className="organic-report-card__hint">
            <strong>สินค้าที่เลือก</strong>
            <span>{selectedProductLabel}</span>
          </div>
        ) : null}

        {catalogError ? <div className="lot-warning organic-report-warning">{catalogError}</div> : null}
        {generateError ? <div className="lot-warning organic-report-warning">{generateError}</div> : null}
        {emptyStateText ? <div className="organic-report-card__empty">{emptyStateText}</div> : null}
        {organicSummaryText ? <div className="organic-report-card__summary">{organicSummaryText}</div> : null}

        <div className="organic-report-card__actions">
          <button
            className="primary-button"
            type="button"
            disabled={isLoadingCatalog || isGenerating}
            onClick={handleGenerate}
          >
            {isGenerating ? "กำลังสร้างรายงาน..." : "สร้างรายงานจากข้อมูลจริง"}
          </button>
          <button
            className="outline-button"
            type="button"
            onClick={() => onPrint?.()}
            disabled={!reportData.meta || !reportData.pages.length}
          >
            พิมพ์รายงานจริง
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={handleDownload}
            disabled={!reportData.meta || !reportData.pages.length}
          >
            ดาวน์โหลด CSV จริง
          </button>
        </div>

        <div className="organic-report-card__meta">
          <span>สาขาผู้ใช้ทั่วไปถูกล็อกตาม account โดย backend</span>
          <span>admin เลือกสาขาได้ แต่รายงานยังอิง dispense จริงเท่านั้น</span>
        </div>
      </Card>

      <OrganicReportPreview pages={reportData.pages} meta={reportData.meta} printTarget="organic" />
    </>
  );
}
