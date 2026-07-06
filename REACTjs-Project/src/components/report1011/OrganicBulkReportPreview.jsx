import { formatReportLocationName } from "../../lib/report1011/utils";
import {
  formatOrganicReportMonthLabel,
  getOrganicReportObjects,
  hasOrganicReportPages,
  normalizeOrganicReportCollection,
} from "../../lib/report1011/organicReportShape";
import { OrganicReportPages } from "./OrganicReportPreview";

function countOrganicRows(pages) {
  return Array.isArray(pages)
    ? pages.reduce((sum, page) => sum + (Array.isArray(page?.rows) ? page.rows.length : 0), 0)
    : 0;
}

export default function OrganicBulkReportPreview({ bulkReportData, printTarget = "organic" }) {
  const items = Array.isArray(bulkReportData?.items) ? bulkReportData.items : [];
  const successfulItems = items.filter(
    (item) => item?.status === "success" && hasOrganicReportPages(item?.reportData)
  );
  const failedItems = items.filter((item) => item?.status === "error");

  if (!successfulItems.length) {
    return null;
  }

  return (
    <section
      className="report-preview organic-report-preview organic-report-preview--bulk"
      data-print-target={printTarget}
    >
      <h2 className="report-preview-title no-print">ตัวอย่างรายงานจากข้อมูลจริงแบบหลายสินค้า</h2>

      {failedItems.length ? (
        <div className="organic-bulk-preview__errors no-print">
          <strong>รายการที่สร้างไม่สำเร็จ</strong>
          <div className="organic-bulk-preview__error-list">
            {failedItems.map((item) => (
              <span key={`${item.productId}-error`}>
                {item.productName || item.productId}: {item.errorMessage || "สร้างรายงานไม่สำเร็จ"}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {successfulItems.map((item) => {
        const normalizedReportData = normalizeOrganicReportCollection(item.reportData);
        const reportMeta = normalizedReportData.meta || {};
        const reportPages = Array.isArray(normalizedReportData.pages) ? normalizedReportData.pages : [];
        const productReports = getOrganicReportObjects(normalizedReportData).filter(
          (report) => report?.meta && Array.isArray(report?.pages) && report.pages.length
        );
        const branchName =
          formatReportLocationName(reportMeta?.branchCode || reportMeta?.branchNameOnly) || "-";

        return (
          <section key={item.productId} className="organic-bulk-preview__group">
            <div className="organic-bulk-preview__group-head no-print">
              <div>
                <strong>{reportMeta?.product || item.productName || item.productId}</strong>
                <span>
                  {[reportMeta?.productCode || item.productCode, reportMeta?.reportGroupCode, branchName]
                    .filter(Boolean)
                    .join(" • ")}
                </span>
              </div>
              <div className="organic-bulk-preview__group-stats">
                <span>{reportPages.length.toLocaleString("th-TH")} lot</span>
                <span>{countOrganicRows(reportPages).toLocaleString("th-TH")} รายการจ่าย</span>
              </div>
            </div>

            {productReports.length <= 1 ? (
              <OrganicReportPages pages={reportPages} meta={reportMeta} />
            ) : (
              productReports.map((report, index) => {
                const monthLabel = formatOrganicReportMonthLabel(report.monthLabel || report.monthKey);
                return (
                  <section
                    key={`${item.productId}-${report.monthKey || "report"}-${index}`}
                    className="organic-bulk-preview__report-group"
                  >
                    <div className="organic-bulk-preview__report-head no-print">
                      <div>
                        <strong>{monthLabel ? `รายงานเดือน ${monthLabel}` : `รายงานชุดที่ ${index + 1}`}</strong>
                        <span>{report.meta?.reportGroupCode || "-"}</span>
                      </div>
                      <div className="organic-bulk-preview__group-stats">
                        <span>{report.pages.length.toLocaleString("th-TH")} lot</span>
                        <span>{countOrganicRows(report.pages).toLocaleString("th-TH")} รายการจ่าย</span>
                      </div>
                    </div>
                    <OrganicReportPages pages={report.pages} meta={report.meta} />
                  </section>
                );
              })
            )}
          </section>
        );
      })}
    </section>
  );
}
