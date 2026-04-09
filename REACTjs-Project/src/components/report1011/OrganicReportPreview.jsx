import { fmtThai, formatReportLocationList, formatReportLocationName } from "../../lib/report1011/utils";

const ROWS_PER_PAGE = 10;

function PageSheet({ meta, lot, rows }) {
  const branchName = formatReportLocationName(meta?.branchCode || meta?.branchNameOnly) || "-";
  const sourceName = formatReportLocationList(lot?.sourceName) || "-";

  return (
    <section className="page">
      <div className="page-head">
        <h2 className="page-title">
          {meta?.reportTitle ||
            "บัญชีการขายยาอันตราย เฉพาะรายการยาที่เลขาธิการคณะกรรมการอาหารและยากำหนด"}
        </h2>

        <div className="page-branch">
          <span>
            <b>ศิริชัยเภสัช สาขา:</b> {branchName}
          </span>
        </div>
        <div className="page-branch-note">(ชื่อสถานที่ขายยา)</div>

        <div className="page-line">
          <span className="page-line-item">
            <b>ชื่อยา</b>
            <span>{meta?.product || "-"}</span>
          </span>
          <span className="page-line-item">
            <b>ขนาดบรรจุ</b>
            <span>{meta?.packSize || "-"}</span>
          </span>
          <span className="page-line-item">
            <b>จำนวนที่รับ</b>
            <span>{lot?.receivedQuantityText || "-"}</span>
          </span>
        </div>

        <div className="page-line">
          <span className="page-line-item">
            <b>ชื่อผู้ผลิต/ผู้นำเข้า</b>
            <span>{meta?.maker || "-"}</span>
          </span>
          <span className="page-line-item">
            <b>เลขครั้งที่ผลิต</b>
            <span>{lot?.batch || "-"}</span>
          </span>
          <span className="page-line-item">
            <b>วันที่รับ</b>
            <span>{fmtThai(lot?.date || "")}</span>
          </span>
        </div>

        <div className="page-line">
          <span className="page-line-item">
            <b>ได้มาจาก</b>
            <span>{sourceName}</span>
          </span>
        </div>
      </div>

      <table className="page-table">
        <thead>
          <tr>
            <th>ลำดับที่</th>
            <th>วัน เดือน ปี ที่ขาย</th>
            <th>จำนวน / ปริมาณ ที่ขาย</th>
            <th>ชื่อ-สกุล ผู้ซื้อ</th>
            <th>เลขบัตรประชาชน</th>
            <th>ลายมือชื่อ เภสัชกร</th>
            <th>หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.seq}-${row.pid}-${row.date}`}>
              <td>{row.seq}</td>
              <td>{row.date}</td>
              <td className="right">{row.qtyText}</td>
              <td className="left">{row.name}</td>
              <td>{row.pid}</td>
              <td />
              <td>{row.note || ""}</td>
            </tr>
          ))}
          {rows.length < ROWS_PER_PAGE
            ? Array.from({ length: ROWS_PER_PAGE - rows.length }).map((_, index) => (
                <tr key={`empty-${index}`}>
                  <td>{rows.length + index + 1}</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                </tr>
              ))
            : null}
        </tbody>
      </table>
    </section>
  );
}

export function OrganicReportPages({ pages, meta }) {
  if (!Array.isArray(pages) || !pages.length || !meta) {
    return null;
  }

  return (
    <>
      {pages.map((page, pageIndex) => {
        const chunks = [];
        for (let i = 0; i < page.rows.length; i += ROWS_PER_PAGE) {
          chunks.push(page.rows.slice(i, i + ROWS_PER_PAGE));
        }

        return chunks.map((rows, chunkIndex) => (
          <PageSheet
            key={`${pageIndex}-${chunkIndex}`}
            meta={meta}
            lot={page.lot}
            rows={rows.map((row, index) => ({
              ...row,
              seq: index + 1,
              date: fmtThai(row.date),
            }))}
          />
        ));
      })}
    </>
  );
}

export default function OrganicReportPreview({ pages, meta, printTarget = "organic" }) {
  if (!Array.isArray(pages) || !pages.length || !meta) {
    return null;
  }

  return (
    <section className="report-preview organic-report-preview" data-print-target={printTarget}>
      <h2 className="report-preview-title no-print">ตัวอย่างรายงานจากข้อมูลจริง</h2>
      <OrganicReportPages pages={pages} meta={meta} />
    </section>
  );
}
