import { useMemo, useState } from "react";
import { PURCHASE_BRANCHES, PURCHASE_BRANCH_NAMES, purchaseLotGapsCsv, purchaseRowsCsv, reconcilePurchases, selectPurchaseDocumentRows } from "../../lib/report1011/purchaseBulk.js";
import "./PurchaseBulkReport.css";

const number = (value) => Number(value || 0).toLocaleString("th-TH", { maximumFractionDigits: 6 });
const dateText = (date) => { const [year, month, day] = date.split("-"); return `${day}/${month}/${Number(year) + 543}`; };
const statusText = { matched: "ตรงกับหลักฐาน", manual: "ยืนยันแล้ว", proposed: "ล็อต/ใบรับที่เสนอ", pending: "รอจับคู่" };
function download(filename, value, type = "application/json") {
  const url = URL.createObjectURL(new Blob([value], { type: `${type};charset=utf-8` }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PurchasePages({ documents, previewBranch }) {
  return <section className="report-preview purchase-preview" data-print-target="purchase-bulk" aria-label="ตัวอย่างเอกสาร ขย.9">
    {documents.map((document) => <div key={document.branch} className={`purchase-preview-branch${previewBranch !== document.branch ? " is-preview-hidden" : ""}`}>
      {Array.from({ length: Math.ceil(document.rows.length / 8) }, (_, page) => {
        const rows = document.rows.slice(page * 8, page * 8 + 8);
        return <article className="purchase-sheet" key={page}>
          <div className="purchase-sheet-top"><span>ฉบับร่าง — ตรวจสอบก่อนลงนาม</span><span>แบบ ข.ย. ๙</span></div>
          <h2>บัญชีการซื้อยา</h2><p className="purchase-location">{document.name}</p><p className="purchase-location-label">(ชื่อสถานที่ขายยา)</p>
          <table><colgroup>{[5, 10, 18, 21, 11, 9, 12, 14].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup>
            <thead><tr>{["ลำดับที่", "วัน เดือน ปี ที่ซื้อ", "ชื่อผู้ขาย", "ชื่อยา", "เลขที่หรืออักษรของครั้งที่ผลิต", "จำนวน / ปริมาณ", "ลายมือชื่อผู้มีหน้าที่ปฏิบัติการ", "หมายเหตุ"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{Array.from({ length: 8 }, (_, i) => {
              const row = rows[i];
              return <tr key={row?.id || `empty-${i}`}><td>{page * 8 + i + 1}</td><td>{row ? dateText(row.date) : ""}</td><td>{row?.supplier}</td>
                <td>{row?.productName}{row ? <small>{row.productCode}</small> : null}</td><td>{row ? row.lot || "รอเชื่อมล็อต" : ""}</td><td>{row ? `${number(row.qty)} ${row.unit}` : ""}</td><td />
                <td>{row ? `${row.type === "transfer" ? "ใบโอน" : "ใบรับ"} ${row.documentNo}` : ""}{row?.freeGoods ? <small>สินค้าแถม</small> : null}{row && !row.ready ? <small className="purchase-review-note">รอตรวจ{row.status === "proposed" && row.lot ? " / ล็อตที่เสนอ" : ""}</small> : null}</td></tr>;
            })}</tbody></table>
          <div className="purchase-sheet-foot"><span>สาขา {document.branch} · {document.heldLotRows ? `ยังไม่รวม ${document.heldLotRows} รายการที่ยังไม่เชื่อมล็อต · ดู CSV` : "เอกสารประกอบจากใบรับและใบโอน · รายการรอตรวจดูใน CSV"}</span><span>หน้า {page + 1} / {Math.ceil(document.rows.length / 8)}</span></div>
        </article>;
      })}
    </div>)}
  </section>;
}

export default function PurchaseBulkReportCard({ onPrint }) {
  const [collapsed, setCollapsed] = useState(true);
  const [sources, setSources] = useState(null), [movements, setMovements] = useState(null);
  const [sourceName, setSourceName] = useState(""), [movementName, setMovementName] = useState("");
  const [review, setReview] = useState({ edits: {}, receiptMatches: {}, transferMatches: {} });
  const [dates, setDates] = useState({ from: "", to: "" });
  const [selectedBranches, setSelectedBranches] = useState(PURCHASE_BRANCHES);
  const [branchFilter, setBranchFilter] = useState("all"), [query, setQuery] = useState(""), [onlyReview, setOnlyReview] = useState(true);
  const [reviewPage, setReviewPage] = useState(0), [reading, setReading] = useState(false), [error, setError] = useState("");
  const [documents, setDocuments] = useState([]), [previewBranch, setPreviewBranch] = useState("");
  const [readyOnly, setReadyOnly] = useState(false), [checkedProposals, setCheckedProposals] = useState(false);
  const [includeUnlinkedLots, setIncludeUnlinkedLots] = useState(false);
  const invalidate = () => { setDocuments([]); setCheckedProposals(false); };
  const changeReview = (field, key, value) => {
    const aliases = field === "transferMatches" ? result?.rows?.find((row) => row.id === key)?.pairedEventIds || [] : [];
    invalidate(); setReview((previous) => ({ ...previous, [field]: { ...previous[field], [key]: value, ...Object.fromEntries(aliases.map((id) => [id, value])) } }));
  };
  const result = useMemo(() => {
    if (!sources || !movements) return null;
    try { return reconcilePurchases({ sourceInput: sources, movementInput: movements, ...review, dateFrom: dates.from, dateTo: dates.to }); }
    catch (failure) { return { failure: failure.message }; }
  }, [sources, movements, review, dates]);
  const valid = result && !result.failure;
  const rows = valid ? result.rows.filter((row) => (branchFilter === "all" || row.branch === branchFilter) && (!onlyReview || !row.ready)
    && `${row.productCode} ${row.productName} ${row.documentNo} ${row.lot}`.toLowerCase().includes(query.toLowerCase().trim())) : [];
  const visibleRows = rows.slice(reviewPage * 40, reviewPage * 40 + 40);
  const filteredBranches = valid ? result.branches.filter((branch) => selectedBranches.includes(branch.branch)) : [];
  const unlinkedSources = valid ? result.sources.filter((source) => !result.receiptJobs.some((job) => job.sourceId === source.id)) : [];
  const allSelectedRows = filteredBranches.flatMap((branch) => branch.rows);
  const selectedRows = selectPurchaseDocumentRows(allSelectedRows, { readyOnly, includeUnlinkedLots });
  const csvRows = allSelectedRows.filter((row) => !readyOnly || row.ready);
  const lotGapRows = allSelectedRows.filter((row) => !row.lot);
  const dateError = dates.from && dates.to && dates.from > dates.to;
  const rangeError = valid && ((dates.from && result.dateFrom && dates.from < result.dateFrom) || (dates.to && result.dateTo && dates.to > result.dateTo));
  const proposals = visibleRows.filter((row) => row.type === "transfer" && row.status === "proposed" && row.sourceId);
  async function importFile(file, type) {
    if (!file) return;
    setReading(true); setError("");
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 30 MB โปรดแบ่งช่วงวันที่");
      const input = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
      if (input.type === "ky9-bulk") {
        reconcilePurchases({ sourceInput: input.sources, movementInput: input.movements, ...(input.review || {}) });
        setSources(input.sources); setMovements(input.movements); setSourceName(file.name); setMovementName(file.name);
        setReview({ edits: input.review?.edits || {}, receiptMatches: input.review?.receiptMatches || {}, transferMatches: input.review?.transferMatches || {} });
        setDates(input.settings?.dates || { from: "", to: "" });
        setSelectedBranches((input.settings?.selectedBranches || PURCHASE_BRANCHES).filter((branch) => PURCHASE_BRANCHES.includes(branch)));
        setReadyOnly(input.settings?.readyOnly === true); setIncludeUnlinkedLots(input.settings?.includeUnlinkedLots === true);
      } else if (type === "sources") {
        const records = Array.isArray(input) ? input : input.source_records;
        if (!Array.isArray(records)) throw new Error("เลือกไฟล์ทะเบียนเอกสารสแกน source_records หรือ ky9_bundle.json");
        setSources({ source_records: records }); setSourceName(file.name);
        setReview({ edits: {}, receiptMatches: {}, transferMatches: {} });
        setReadyOnly(false); setIncludeUnlinkedLots(false);
      } else {
        if (!Array.isArray(input.receipts) || !Array.isArray(input.transfers)) throw new Error("เลือกไฟล์รับ/โอนที่มี receipts และ transfers");
        setMovements(input); setMovementName(file.name); setReview((previous) => ({ ...previous, receiptMatches: {}, transferMatches: {} }));
      }
      invalidate(); setReviewPage(0);
    } catch (failure) { setError(`นำเข้า ${file.name} ไม่สำเร็จ: ${failure.message}`); }
    finally { setReading(false); }
  }
  function createDocuments() {
    const next = filteredBranches.map((branch) => ({ ...branch,
      heldLotRows: includeUnlinkedLots ? 0 : branch.rows.filter((row) => !row.lot).length,
      rows: selectPurchaseDocumentRows(branch.rows, { readyOnly, includeUnlinkedLots }).map((row) => ({ ...row })) })).filter((branch) => branch.rows.length);
    setDocuments(next); setPreviewBranch(next[0]?.branch || "");
  }
  function saveReview() {
    download("ky9_bundle_review.json", JSON.stringify({ version: 1, type: "ky9-bulk", sources, movements, review, settings: { dates, selectedBranches, readyOnly, includeUnlinkedLots }, savedAt: new Date().toISOString() }, null, 2));
  }
  return <section className={`report1011-section card purchase-bulk${collapsed ? " is-collapsed" : ""}`}>
    <button type="button" className="report1011-section__toggle" aria-expanded={!collapsed} aria-controls="purchase-bulk-section" onClick={() => setCollapsed((value) => !value)}>
      <span className="report1011-section__title">Bulk ขย.9 · บัญชีซื้อยาหลายสาขา</span><span className="report1011-section__meta"><span>{collapsed ? "ขยาย" : "ย่อ"}</span><span className="report1011-section__chevron" aria-hidden="true" /></span>
    </button>
    <div id="purchase-bulk-section" className="report1011-section__body" hidden={collapsed}>
      <div className="no-print">
        <p>นำเข้าทะเบียนจากเอกสารสแกนและรายการรับ/โอนจาก Movement Trace เพื่อสร้างบัญชีซื้อยาแยกทุกสาขาในครั้งเดียว</p>
        <div className="purchase-fields">
          <label>1. ชุดข้อมูล ขย.9 หรือทะเบียนเอกสารสแกน<input type="file" accept=".json" disabled={reading} onChange={(event) => { importFile(event.target.files[0], "sources"); event.target.value = ""; }} /><small>{sourceName || "ky9_bundle.json นำเข้าข้อมูลทั้งสองชุดได้ในไฟล์เดียว"}</small></label>
          <label>2. รายการรับ / โอนจาก Movement Trace<input type="file" accept=".json" disabled={reading} onChange={(event) => { importFile(event.target.files[0], "movements"); event.target.value = ""; }} /><small>{movementName || "stockday_movements.json · ไม่จำเป็นเมื่อใช้ชุดข้อมูลรวม"}</small></label>
          <label>วันที่รับตั้งแต่<input type="date" value={dates.from} onChange={(event) => { invalidate(); setDates({ ...dates, from: event.target.value }); setReviewPage(0); }} /></label>
          <label>วันที่รับถึง<input type="date" value={dates.to} onChange={(event) => { invalidate(); setDates({ ...dates, to: event.target.value }); setReviewPage(0); }} /></label>
        </div>
        {reading ? <p role="status">กำลังอ่านข้อมูล…</p> : null}
        {error || result?.failure ? <p role="alert" className="purchase-warning">{error || result.failure}</p> : null}
        {valid ? <>
          <div className="purchase-summary" role="status"><strong>{number(result.rows.length)} รายการรับ · {number(result.sources.length)} รายการซื้อในกลุ่มยา · {result.branches.filter((branch) => branch.rows.length).length} สาขา</strong>
            <span>พร้อมใช้ {number(result.rows.filter((row) => row.ready).length)} · รอตรวจ {number(result.rows.filter((row) => !row.ready).length)} · แยกสินค้าที่ไม่ใช่ยา {result.excluded.length} รายการ</span>
            <span>เชื่อมล็อตจากใบสแกน {number(result.rows.filter((row) => row.lot).length)} · ยังไม่เชื่อมล็อต {number(result.rows.filter((row) => !row.lot).length)} รายการ</span>
            {unlinkedSources.length ? <span>เอกสารซื้อที่ยังไม่เชื่อมใบรับ {unlinkedSources.length} รายการ — ตรวจรหัสสินค้าและการจับคู่ด้านล่าง</span> : null}
            <small>ข้อมูล Movement Trace: {result.dateFrom} ถึง {result.dateTo} · ตัดรายการซ้ำ {result.duplicates} · รวมคู่รับ/จ่ายใบโอน {result.mirroredTransfers.length} คู่ · ไม่รวมรายการยกเลิก {result.cancelled}</small>
          </div>
          {result.errors.length ? <div role="alert" className="purchase-warning">ข้อมูลต้นทางมีข้อผิดพลาด {result.errors.length} รายการ โปรดแก้ก่อนสร้างเอกสาร<ul>{result.errors.slice(0, 10).map((item, i) => <li key={i}>{item.eventId}: {item.message}</li>)}</ul></div> : null}
          {dateError || rangeError ? <p role="alert" className="purchase-warning">{dateError ? "วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด" : "ช่วงวันที่ที่เลือกเกินข้อมูล Movement Trace ที่นำเข้า กรุณานำเข้าข้อมูลให้ครอบคลุม"}</p> : null}
          <details className="purchase-review"><summary>ตรวจข้อมูลซื้อจากเอกสารสแกน ({result.sources.length} รายการ · รอแก้ {result.sourceIssues.length})</summary>
            <p>วันที่ในเอกสารซื้อใช้ตรวจการจับคู่ วันที่พิมพ์ในบัญชีใช้วันที่รับจริงจากระบบ สินค้าที่ไม่ใช่ยาจะไม่เข้าเอกสาร ขย.9</p>
            <div className="purchase-source-list">{result.sources.map((source) => <details key={source.id}><summary>{source.code || "รอรหัส"} · {source.name} · {source.lot}{source.issues.length ? " · รอตรวจ" : ""}</summary>
              <div className="purchase-fields">{[["code", "รหัสสินค้า", source.code], ["name", "ชื่อยา", source.name], ["lot", "ล็อต", source.lot], ["mfg", "วันผลิตตามใบสแกน", source.manufacturedDate], ["exp", "วันหมดอายุตามใบสแกน", source.expiry], ["invoice_no", "เลขใบกำกับ", source.invoiceNo], ["invoice_date", "วันที่เอกสารซื้อ", source.invoiceDate], ["source_qty", "จำนวนตามเอกสาร (รวมแถม)", source.sourceQuantity], ["source_unit", "หน่วยตามเอกสาร", source.sourceUnit], ["source_supplier", "ผู้ขายตามเอกสาร", source.supplier]].map(([field, label, value]) => <label key={field}>{label}<input aria-label={`${label} ${source.id}`} type={["invoice_date", "mfg", "exp"].includes(field) ? "date" : field === "source_qty" ? "number" : "text"} value={value ?? ""} onChange={(event) => changeReview("edits", source.id, { ...review.edits[source.id], [field]: event.target.value })} /></label>)}
                <label>ประเภทสินค้า<select aria-label={`ประเภทสินค้า ${source.id}`} value={source.kind} onChange={(event) => changeReview("edits", source.id, { ...review.edits[source.id], kind: event.target.value })}><option value="drug">ยา</option><option value="type_pending">รอตรวจประเภท</option><option value="classification_pending">รอจัดประเภท</option><option value="non_drug">ไม่ใช่ยา — ไม่สร้าง ขย.9</option><option value="dietary_supplement">อาหารเสริม — ไม่สร้าง ขย.9</option></select></label>
                <label>จำนวนหลังแปลงหน่วยตามหลักฐาน<input type="number" aria-label={`จำนวนหลังแปลงหน่วย ${source.id}`} value={Number.isFinite(source.baseQuantity) ? source.baseQuantity : ""} onChange={(event) => changeReview("edits", source.id, { ...review.edits[source.id], cap_qty: event.target.value })} /></label>
                <label>หน่วยหลังแปลง<input aria-label={`หน่วยหลังแปลง ${source.id}`} value={source.baseUnit} onChange={(event) => changeReview("edits", source.id, { ...review.edits[source.id], cap_unit: event.target.value })} /></label>
                <label>หลักฐานการแปลงหน่วย<select aria-label={`หลักฐานการแปลงหน่วย ${source.id}`} value={source.conversionStatus} onChange={(event) => changeReview("edits", source.id, { ...review.edits[source.id], quantity_conversion_status: event.target.value })}><option value="SOURCE_UNIT_ONLY">มีเฉพาะหน่วยซื้อ</option><option value="EXPLICIT_PRIOR_FACTS">ตรวจหน่วยและจำนวนจากหลักฐานแล้ว</option><option value="SOURCE_PACK">แปลงตามบรรจุภัณฑ์ที่ระบุในใบ</option><option value="PACK_SIZE_NOT_PRINTED">ใบไม่ระบุขนาดบรรจุ</option><option value="">รอตรวจ</option></select></label>
              </div><small>หลักฐาน: {source.file || "ไม่ได้ระบุไฟล์"}</small>
              {source.candidateCodes.length ? <p>รหัสที่ต้องตรวจจากฉลาก: {source.candidateCodes.map((candidate) => `${candidate.code} ${candidate.name} (${candidate.barcode || "ไม่มีบาร์โค้ด"})`).join(" · ")}</p> : null}
              {source.mappingNote ? <small>{source.mappingNote}</small> : null}
              {source.issues.length ? <p className="purchase-warning">{source.issues.join(" · ")}</p> : null}
            </details>)}</div>
            {result.excluded.length ? <details><summary>รายการที่แยกออก ({result.excluded.length})</summary>{result.excluded.map((source) => <p key={source.id}>{source.name} · {source.kind}<button type="button" className="ghost-button" onClick={() => changeReview("edits", source.id, { ...review.edits[source.id], kind: "type_pending" })}>นำกลับมาตรวจประเภท</button></p>)}</details> : null}
          </details>
          <details className="purchase-review"><summary>จับคู่ใบรับกับเอกสารซื้อ ({result.receiptJobs.length} ชุด)</summary>
            <div className="purchase-source-list">{result.receiptJobs.map((job) => <div className="purchase-receipt" key={job.key}><strong>{job.doc} · {job.code} · {dateText(job.date)}</strong><small>{job.supplier} · อ้างอิง {job.invoice || "ไม่ระบุ"} · {statusText[job.status]}</small>
              <select aria-label={`เอกสารซื้อของ ${job.doc} ${job.code}`} value={job.sourceId} onChange={(event) => changeReview("receiptMatches", job.key, event.target.value)}><option value="">— รอจับคู่ —</option>{job.candidates.map((source) => <option key={source.id} value={source.id}>{source.lot} · {source.invoiceNo || source.invoiceDate} · {source.sourceQuantity} {source.sourceUnit}</option>)}</select>
              {job.status === "proposed" ? <button type="button" className="outline-button" onClick={() => changeReview("receiptMatches", job.key, job.sourceId)}>ยืนยันเอกสารซื้อที่เสนอ</button> : null}{job.issues.length ? <p className="purchase-warning">{job.issues.join(" · ")}</p> : null}
            </div>)}</div>
          </details>
          <details className="purchase-review" open><summary>ตรวจล็อตของรายการรับ / โอน</summary>
            <p>ใบโอนที่ไม่มีล็อตจะแสดงล็อตที่เสนอจากรายการรับต้นทาง ต้องตรวจหลักฐานและยืนยันเอง การเสนอไม่ได้หักยอดขายและไม่ใช้แทนยอดสต็อกจริง</p>
            <div className="purchase-fields"><label>ดูสาขา<select value={branchFilter} onChange={(event) => { setBranchFilter(event.target.value); setReviewPage(0); setCheckedProposals(false); }}><option value="all">ทุกสาขา</option>{PURCHASE_BRANCHES.map((branch) => <option key={branch} value={branch}>{branch} · {PURCHASE_BRANCH_NAMES[branch]}</option>)}</select></label>
              <label>ค้นหาสินค้า / เอกสาร / ล็อต<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setReviewPage(0); setCheckedProposals(false); }} /></label></div>
            <label className="purchase-check"><input type="checkbox" checked={onlyReview} onChange={(event) => { setOnlyReview(event.target.checked); setReviewPage(0); setCheckedProposals(false); }} />แสดงเฉพาะรายการรอตรวจ</label>
            <div className="purchase-table-scroll"><table className="purchase-review-table"><thead><tr>{["วันที่ / สาขา", "ยา / เอกสาร", "จำนวน", "ล็อต / หลักฐาน", "ผลตรวจ"].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{visibleRows.map((row) => <tr key={row.id}><td>{dateText(row.date)}<small>สาขา {row.branch}</small></td><td>{row.productName}<small>{row.productCode} · {row.documentNo}{row.freeGoods ? " · แถม" : ""}</small></td><td>{number(row.qty)} {row.unit}</td><td>{row.type === "transfer" ? <><select aria-label={`ล็อต ${row.id}`} value={row.sourceId} onChange={(event) => changeReview("transferMatches", row.id, event.target.value)}><option value="">— รอเลือกล็อต —</option>{result.sources.filter((source) => source.code === row.productCode).map((source) => <option key={source.id} value={source.id}>{source.lot} · {source.invoiceNo || source.invoiceDate}</option>)}</select>{row.status === "proposed" ? <button type="button" className="ghost-button" onClick={() => changeReview("transferMatches", row.id, row.sourceId)}>ยืนยันล็อตนี้</button> : null}</> : row.lot || "รอจับคู่ใบรับ"}{row.manufacturedDate ? <small>ผลิต {dateText(row.manufacturedDate)}</small> : null}{row.expiry ? <small>หมดอายุ {dateText(row.expiry)}</small> : null}<small>{row.sourceFile}</small></td><td>{row.ready ? "พร้อมใช้" : statusText[row.status]}{row.issues.map((issue) => <small className="purchase-review-note" key={issue}>{issue}</small>)}</td></tr>)}</tbody></table></div>
            {!rows.length ? <p>ไม่มีรายการตามตัวกรองนี้</p> : <div className="purchase-actions"><button type="button" className="outline-button" disabled={!reviewPage} onClick={() => { setReviewPage((page) => page - 1); setCheckedProposals(false); }}>ก่อนหน้า</button><span>{number(reviewPage * 40 + 1)}–{number(Math.min((reviewPage + 1) * 40, rows.length))} / {number(rows.length)}</span><button type="button" className="outline-button" disabled={(reviewPage + 1) * 40 >= rows.length} onClick={() => { setReviewPage((page) => page + 1); setCheckedProposals(false); }}>ถัดไป</button></div>}
            {proposals.length ? <div className="purchase-actions"><label className="purchase-check"><input type="checkbox" checked={checkedProposals} onChange={(event) => setCheckedProposals(event.target.checked)} />ตรวจหลักฐานและล็อตที่เสนอของรายการโอนในหน้านี้แล้ว ({proposals.length} รายการ)</label><button type="button" className="outline-button" disabled={!checkedProposals} onClick={() => { invalidate(); setReview((previous) => ({ ...previous, transferMatches: { ...previous.transferMatches, ...Object.fromEntries(proposals.map((row) => [row.id, row.sourceId])) } })); }}>ยืนยันล็อตที่เสนอในหน้านี้</button></div> : null}
          </details>
          <fieldset className="purchase-branches"><legend>สาขาที่สร้างเอกสาร</legend>{filteredBranches.length === 0 ? <small>เลือกอย่างน้อยหนึ่งสาขา</small> : null}{result.branches.map((branch) => <label className="purchase-check" key={branch.branch}><input type="checkbox" checked={selectedBranches.includes(branch.branch)} onChange={(event) => { invalidate(); setSelectedBranches(event.target.checked ? [...selectedBranches, branch.branch] : selectedBranches.filter((id) => id !== branch.branch)); }} /><span>{branch.branch} · {branch.name}<small>{branch.rows.length} รายการ · พร้อมใช้ {branch.rows.filter((row) => row.ready).length}</small></span></label>)}</fieldset>
          <label className="purchase-check"><input type="checkbox" checked={readyOnly} onChange={(event) => { invalidate(); setReadyOnly(event.target.checked); }} />สร้างเฉพาะรายการพร้อมใช้ (หากไม่เลือกจะรวมรายการรอตรวจในฉบับร่าง)</label>
          <label className="purchase-check"><input type="checkbox" checked={includeUnlinkedLots} onChange={(event) => { invalidate(); setIncludeUnlinkedLots(event.target.checked); }} />รวมรายการที่ยังไม่เชื่อมล็อตใน PDF (แสดงคำว่า “รอเชื่อมล็อต”)</label>
          <p>PDF จะมี {number(selectedRows.length)} รายการ{lotGapRows.length && !includeUnlinkedLots ? ` · แยก ${number(lotGapRows.length)} รายการที่ยังไม่เชื่อมล็อตไว้ตรวจใน CSV` : ""} · CSV ข้อมูลรับ/โอนมี {number(csvRows.length)} รายการ</p>
          <div className="purchase-actions"><button type="button" className="primary-button" disabled={!selectedRows.length || dateError || rangeError || result.errors.length > 0 || reading} onClick={createDocuments}>สร้างเอกสารฉบับร่าง</button><button type="button" className="outline-button" onClick={saveReview}>บันทึกข้อมูลและการตรวจ</button><button type="button" className="ghost-button" disabled={!csvRows.length} onClick={() => download("ky9_purchase_review.csv", purchaseRowsCsv(csvRows), "text/csv")}>ดาวน์โหลด CSV</button>{lotGapRows.length ? <button type="button" className="outline-button" onClick={() => download("ky9_lot_gaps.csv", purchaseLotGapsCsv({ ...result, rows: allSelectedRows }), "text/csv")}>ดาวน์โหลดรายการที่ยังไม่เชื่อมล็อต</button> : null}</div>
          {documents.length ? <div className="purchase-actions"><label>ตัวอย่างสาขา<select value={previewBranch} onChange={(event) => setPreviewBranch(event.target.value)}>{documents.map((branch) => <option key={branch.branch} value={branch.branch}>{branch.branch} · {branch.rows.length} รายการ</option>)}</select></label><span>{documents.length} สาขา · {documents.reduce((sum, branch) => sum + Math.ceil(branch.rows.length / 8), 0)} หน้า</span><button type="button" className="primary-button" onClick={onPrint}>พิมพ์ / บันทึก PDF ทุกสาขาที่เลือก</button></div> : null}
        </> : null}
      </div>
      {documents.length ? <PurchasePages documents={documents} previewBranch={previewBranch} /> : null}
    </div>
  </section>;
}
