import { useEffect, useMemo, useRef, useState } from "react";
import { BRANCHES } from "../../data/branches";
import { authApiClient } from "../../lib/authApi";
import {
  buildLotsTemplate, buildSalesTemplate, createCombinedBulkSources, importBulkSources, normalizeBulkProducts,
  readBulkFile, readCombinedBulkFile, validateBulkLots,
} from "../../lib/report1011/bulkImport.js";
import { buildBulkReportCsv, buildBulkReportItem } from "../../lib/report1011/buildBulkReport.js";
import { ReportPages } from "./ReportPreview";
import "./ManualBulkReport.css";

// Keep legacy single-mode branches unchanged; the new workflow includes 005.
const BULK_BRANCHES = [...BRANCHES, { value: "005", label: "005 : ถนนเอกชัยสมุทรสาคร" }];
const emptyLot = () => ({ batch: "", date: "", boxes: "", strips: "" });
const number = (value) => Number(value || 0).toLocaleString("th-TH");
const REFERENCE_KEY = "stockday-20260618-20260927-dev-v1";
const REFERENCE_LABEL = "18 มิ.ย.–27 ก.ย. 2026 · StockDay · 27 สินค้า / 4 สาขา";

function downloadText(filename, csvText) {
  const url = URL.createObjectURL(new Blob([csvText], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ImportErrors({ title, errors }) {
  if (!errors.length) return null;
  return (
    <details className="manual-bulk-errors" open>
      <summary>{title} ({number(errors.length)} รายการ)</summary>
      <ul>{errors.slice(0, 20).map((error, index) => <li key={index}>{error.location}: {error.message}</li>)}</ul>
      {errors.length > 20 ? <p>แสดง 20 รายการแรก โปรดแก้ไฟล์ต้นทางแล้วนำเข้าใหม่</p> : null}
    </details>
  );
}

function SalesSourceSettings({ source, products, onChange, onRemove, index }) {
  const fields = [["date", "วันที่ขาย"], ["qty", "จำนวนขาย"], ["branch", "คอลัมน์สาขา"], ["product", "คอลัมน์สินค้า"]];
  return (
    <details className="manual-bulk-file" open={source.columns.branch < 0 || source.columns.product < 0}>
      <summary>{source.name} · {number(source.rows.length)} แถว</summary>
      <div className="manual-bulk-fields">
        {fields.map(([field, label]) => (
          <label key={field}>{label}
            <select aria-label={`${label} ไฟล์ ${index + 1}`} value={source.columns[field]}
              onChange={(event) => onChange({ columns: { ...source.columns, [field]: Number(event.target.value) } })}>
              <option value={-1}>{field === "branch" || field === "product" ? "เลือกให้ทั้งไฟล์" : "— เลือกคอลัมน์ —"}</option>
              {source.header.map((header, column) => <option key={column} value={column}>{header || `คอลัมน์ ${column + 1}`}</option>)}
            </select>
          </label>
        ))}
        {source.columns.branch < 0 ? <label>สาขาของไฟล์
          <select aria-label={`สาขาของไฟล์ ${index + 1}`} value={source.branchId} onChange={(event) => onChange({ branchId: event.target.value })}>
            <option value="">เลือกสาขา</option>{BULK_BRANCHES.map((branch) => <option key={branch.value} value={branch.value}>{branch.label}</option>)}
          </select>
        </label> : null}
        {source.columns.product < 0 ? <label>สินค้าของไฟล์
          <select aria-label={`สินค้าของไฟล์ ${index + 1}`} value={source.productId} onChange={(event) => onChange({ productId: event.target.value })}>
            <option value="">เลือกสินค้า</option>{products.filter((product) => product.groups.includes("KY11")).map((product) => <option key={product.id} value={product.id}>{product.code} · {product.value}</option>)}
          </select>
        </label> : null}
      </div>
      <label className="manual-bulk-check">
        <input type="checkbox" checked={source.skipLegacyFirstRow} onChange={(event) => onChange({ skipLegacyFirstRow: event.target.checked })} />
        ไฟล์จากตัวสร้างเดิมที่เพิ่มแถวแรกซ้ำไว้: ข้ามแถวข้อมูลแรก
      </label>
      <button type="button" className="ghost-button" onClick={onRemove}>นำไฟล์นี้ออก</button>
    </details>
  );
}

export default function ManualBulkReportCard({ catalogProducts, productsLoading, productsError, patientsCsvText, patientsStatus, fetchPatients, sku, onPrint, onBusyChange }) {
  const [sources, setSources] = useState([]);
  const [lotSources, setLotSources] = useState([]);
  const [readErrors, setReadErrors] = useState([]);
  const [reference, setReference] = useState({ status: "waiting", sources: null, error: "" });
  const [isReading, setIsReading] = useState(false);
  const [dates, setDates] = useState({ from: "", to: "" });
  const [lotOverrides, setLotOverrides] = useState({});
  const [selectedKeys, setSelectedKeys] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [results, setResults] = useState([]);
  const [previewKey, setPreviewKey] = useState("");
  const [run, setRun] = useState({ running: false, processed: 0, total: 0, cancelled: false });
  const [runError, setRunError] = useState("");
  const cancelRef = useRef(false);
  const activeRef = useRef(true);
  const userSelectedFileRef = useRef(false);
  const hasCatalog = Boolean(catalogProducts?.length);
  const products = useMemo(() => normalizeBulkProducts(catalogProducts), [catalogProducts]);
  const imported = useMemo(() => importBulkSources({ sources, products, branches: BULK_BRANCHES, dateFrom: dates.from, dateTo: dates.to }), [sources, products, dates]);
  const importedLots = useMemo(() => importBulkSources({ sources: lotSources, products, branches: BULK_BRANCHES, kind: "lots" }), [lotSources, products]);
  const importedLotMap = useMemo(() => new Map(importedLots.groups.map((group) => [group.key, group.lots])), [importedLots]);
  const developmentLotCount = lotSources.reduce((count, source) => {
    const column = source.header.indexOf("receiptBasis");
    return count + (column < 0 ? 0 : source.rows.filter((row) => String(row[column] || "").includes("SIMULATED")).length);
  }, 0);
  const paperHeaderDateCount = lotSources.reduce((count, source) => {
    const column = source.header.indexOf("receivedDateMeaning");
    return count + (column < 0 ? 0 : source.rows.filter((row) => String(row[column] || "").includes("PAPER_DOCUMENT_HEADER_DATE")).length);
  }, 0);
  const jobs = useMemo(() => imported.groups.map((group) => {
    const lots = lotOverrides[group.key] ?? importedLotMap.get(group.key) ?? [];
    return { ...group, lots, error: validateBulkLots(lots, group.totalSold) };
  }), [imported, importedLotMap, lotOverrides]);
  const selectedJobs = jobs.filter((job) => selectedKeys === null || selectedKeys.includes(job.key));
  const successes = results.filter((result) => result.status === "success");
  const failures = results.filter((result) => result.status === "error");
  const busy = run.running || isReading;
  const dateError = dates.from && dates.to && dates.from > dates.to ? "วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด" : "";
  const canBuild = !busy && !productsLoading && !productsError && !dateError && !readErrors.length && !imported.errors.length && !importedLots.errors.length && selectedJobs.length > 0 && selectedJobs.every((job) => !job.error) && confirmed;

  useEffect(() => {
    setConfirmed(false);
    setResults([]);
    setRunError("");
    setRun({ running: false, processed: 0, total: 0, cancelled: false });
  }, [sources, lotSources, dates, lotOverrides, selectedKeys, products, sku]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; cancelRef.current = true; };
  }, []);
  useEffect(() => {
    if (!hasCatalog) return;
    let cancelled = false;
    setReference({ status: "loading", sources: null, error: "" });
    authApiClient.get(`/api/reports/ky11-bulk-source-snapshots/${REFERENCE_KEY}`, { responseType: "text" })
      .then((response) => {
        const saved = createCombinedBulkSources(response.data, `${REFERENCE_LABEL} (บันทึกบนเว็บ)`, REFERENCE_KEY);
        if (cancelled) return;
        setReference({ status: "ready", sources: saved, error: "" });
        if (!userSelectedFileRef.current) {
          setSources([saved.sales]);
          setLotSources([saved.lots]);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setReference({ status: "error", sources: null, error: error?.status === 403
          ? "ชุดข้อมูลที่บันทึกไว้เปิดได้เฉพาะผู้ดูแลระบบ"
          : "โหลดชุดข้อมูลที่บันทึกไว้ไม่สำเร็จ; ยังอัปโหลด CSV เองได้" });
      });
    return () => { cancelled = true; };
  }, [hasCatalog]);

  const restoreReference = () => {
    if (!reference.sources) return;
    setSources([reference.sources.sales]);
    setLotSources([reference.sources.lots]);
    setLotOverrides({});
    setSelectedKeys(null);
    setReadErrors([]);
  };

  const handleUpload = async (files, kind) => {
    if (!files.length) return;
    userSelectedFileRef.current = true;
    setIsReading(true);
    setReadErrors([]);
    const settled = await Promise.allSettled(files.map((file) => readBulkFile(file, kind)));
    if (!activeRef.current) return;
    const loaded = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
    const update = kind === "sales" ? setSources : setLotSources;
    update((previous) => {
      const unique = new Map(previous.map((source) => [source.id, source]));
      loaded.forEach((source) => unique.set(source.id, source));
      return [...unique.values()];
    });
    setReadErrors(settled.flatMap((result, index) => result.status === "rejected" ? [{ location: files[index].name, message: result.reason?.message || "อ่านไฟล์ไม่สำเร็จ" }] : []));
    setIsReading(false);
  };
  const handleCombinedUpload = async (file) => {
    if (!file) return;
    userSelectedFileRef.current = true;
    setIsReading(true);
    setReadErrors([]);
    try {
      const combined = await readCombinedBulkFile(file);
      if (!activeRef.current) return;
      setSources([combined.sales]);
      setLotSources([combined.lots]);
      setLotOverrides({});
      setSelectedKeys(null);
    } catch (error) {
      if (activeRef.current) setReadErrors([{ location: file.name, message: error?.message || "อ่านไฟล์รวมไม่สำเร็จ" }]);
    } finally { if (activeRef.current) setIsReading(false); }
  };
  const updateSource = (id, patch) => setSources((previous) => previous.map((source) => source.id === id ? { ...source, ...patch } : source));
  const updateLots = (job, lots) => setLotOverrides((previous) => ({ ...previous, [job.key]: lots }));
  const toggleJob = (job) => setSelectedKeys((previous) => {
    const current = previous ?? jobs.map((entry) => entry.key);
    return current.includes(job.key) ? current.filter((entry) => entry !== job.key) : [...current, job.key];
  });

  const handleBuild = async (mode = "all") => {
    if (!canBuild) return;
    const queue = mode === "failed" ? selectedJobs.filter((job) => failures.some((result) => result.key === job.key))
      : mode === "remaining" ? selectedJobs.filter((job) => !results.some((result) => result.key === job.key)) : selectedJobs;
    if (!queue.length) return;
    cancelRef.current = false;
    setRunError("");
    let next = mode === "failed" ? results.filter((result) => result.status === "success") : mode === "remaining" ? [...results] : [];
    setResults(next);
    setRun({ running: true, processed: next.length, total: selectedJobs.length, cancelled: false });
    try {
      const patients = patientsCsvText || await fetchPatients();
      if (!patients) throw new Error("โหลดรายชื่อผู้ป่วยไม่สำเร็จ โปรดลองอีกครั้ง");
      for (let index = 0; index < queue.length; index += 1) {
        // Give React and the cancel button a turn between jobs.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelRef.current || !activeRef.current) break;
        const group = queue[index];
        let result;
        try { result = buildBulkReportItem({ group, lots: group.lots, patientsCsvText: patients, sku }); }
        catch (error) { result = { key: group.key, status: "error", error: error?.message || "สร้างรายงานไม่สำเร็จ" }; }
        next = [...next, result];
        setResults(next);
        setRun((previous) => ({ ...previous, processed: next.length }));
      }
      if (activeRef.current) setPreviewKey(next.find((result) => result.status === "success")?.key || "");
    } catch (error) { if (activeRef.current) setRunError(error.message); }
    finally { if (activeRef.current) setRun((previous) => ({ ...previous, running: false, cancelled: cancelRef.current })); }
  };

  return (
    <div className="manual-bulk">
      <fieldset className="manual-bulk-controls no-print" disabled={busy}>
        <legend>สร้าง ขย.11 หลายสินค้า / หลายสาขา</legend>
        <p className="muted">นำเข้ายอดขายครั้งเดียว ระบบแยกสินค้าและสาขา แล้วใช้การจัดสรรยอดซื้อและชื่อผู้ซื้อแบบเดิม</p>
        {productsError ? <p role="alert">{productsError}</p> : null}
        {productsLoading ? <p role="status">กำลังโหลดรายการสินค้า…</p> : null}
        {reference.status === "loading" ? <p role="status">กำลังโหลดชุดข้อมูลอ้างอิงช่วง {REFERENCE_LABEL}…</p> : null}
        {reference.status === "ready" ? <div className="manual-bulk-actions">
          <button type="button" className="outline-button" onClick={restoreReference}>ใช้ชุดข้อมูลอ้างอิงที่บันทึกไว้: {REFERENCE_LABEL}</button>
          <span className="muted">เว็บโหลดชุดนี้ให้อัตโนมัติเมื่อเปิดหน้า และเรียกกลับได้หลังเปลี่ยนไฟล์</span>
        </div> : null}
        {reference.status === "error" ? <p className="muted">{reference.error}</p> : null}
        <label htmlFor="bulk-combined-file">ไฟล์เดียว: ประวัติขายและลอตทุกสินค้า/สาขา (CSV)
          <input id="bulk-combined-file" type="file" accept=".csv" onChange={(event) => { handleCombinedUpload(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        <p className="muted">เลือกไฟล์รวมเพื่อแทนชุดที่อัปโหลดไว้ หรือใช้ช่องแยกด้านล่างตามเดิม</p>
        <div className="manual-bulk-fields">
          <label htmlFor="bulk-sales-files">1. ประวัติขาย (เลือกหลายไฟล์ได้)
            <input id="bulk-sales-files" type="file" accept=".csv,.json" multiple onChange={(event) => { handleUpload([...event.target.files], "sales"); event.target.value = ""; }} />
          </label>
          <label htmlFor="bulk-lot-files">2. ลอตรับเข้าแยกตามสินค้าและสาขา (CSV)
            <input id="bulk-lot-files" type="file" accept=".csv" multiple onChange={(event) => { handleUpload([...event.target.files], "lots"); event.target.value = ""; }} />
          </label>
        </div>
        <div className="manual-bulk-actions">
          <button type="button" className="ghost-button" onClick={() => downloadText("ขย11_sales_template.csv", buildSalesTemplate())}>แม่แบบยอดขาย CSV</button>
          <button type="button" className="ghost-button" onClick={() => downloadText("ขย11_lots_template.csv", buildLotsTemplate(imported.groups))}>แม่แบบลอตตามงานที่นำเข้า</button>
        </div>
        <p className="muted">รองรับ CSV รวมสินค้า/สาขา, CSV เดิมทีละสินค้า และ JSON ประวัติขายที่รวบรวมไว้ · จำนวนต้องอยู่ในหน่วยรายงานเดิม เช่น แผงหรือขวด</p>
        {developmentLotCount || paperHeaderDateCount ? <p role="alert">ข้อมูลลอตในไฟล์นี้: {number(developmentLotCount)} รายการใช้วันที่/ความจุจำลองสำหรับพัฒนาระบบ; {number(paperHeaderDateCount)} รายการใช้วันที่หัวบันทึกกระดาษแทนวันที่รับเข้ารายการนั้น โปรดตรวจเอกสารก่อนใช้ยื่นจริง</p> : null}
        <ImportErrors title="อ่านไฟล์ไม่สำเร็จ" errors={readErrors} />
        {readErrors.length ? <button type="button" className="ghost-button" onClick={() => setReadErrors([])}>นำไฟล์ที่อ่านไม่ได้ออกจากชุดนี้</button> : null}
        {sources.map((source, index) => <SalesSourceSettings key={source.id} source={source} products={products} index={index}
          onChange={(patch) => updateSource(source.id, patch)} onRemove={() => setSources((previous) => previous.filter((entry) => entry.id !== source.id))} />)}
        {lotSources.map((source) => <div className="manual-bulk-file" key={source.id}>{source.name} · {number(source.rows.length)} ลอต
          <button type="button" className="ghost-button" onClick={() => setLotSources((previous) => previous.filter((entry) => entry.id !== source.id))}>นำไฟล์ลอตออก</button>
        </div>)}
        <div className="manual-bulk-fields">
          <label htmlFor="bulk-date-from">วันที่ขายตั้งแต่ (เว้นว่างเพื่อใช้ทั้งหมด)
            <input id="bulk-date-from" type="date" value={dates.from} onChange={(event) => setDates((previous) => ({ ...previous, from: event.target.value }))} />
          </label>
          <label htmlFor="bulk-date-to">ถึงวันที่
            <input id="bulk-date-to" type="date" value={dates.to} onChange={(event) => setDates((previous) => ({ ...previous, to: event.target.value }))} />
          </label>
          <label htmlFor="bulk-source-name">ได้มาจาก
            <input id="bulk-source-name" value={sku} readOnly />
          </label>
        </div>
        {dateError ? <p role="alert">{dateError}</p> : null}
        <p className="muted">รายชื่อผู้ป่วย: {patientsStatus}</p>
        <ImportErrors title="ข้อมูลยอดขายที่ต้องแก้ก่อนสร้าง" errors={imported.errors} />
        <ImportErrors title="ข้อมูลลอตที่ต้องแก้ก่อนสร้าง" errors={importedLots.errors} />
        {sources.length ? <div className="manual-bulk-summary">
          <strong>{number(jobs.length)} งาน · {number(new Set(jobs.map((job) => job.product.id)).size)} สินค้า · {number(new Set(jobs.map((job) => job.branchId)).size)} สาขา</strong>
          <span>{number(imported.rowCount)} บิล/แถว · ขาย {number(jobs.reduce((sum, job) => sum + job.totalSold, 0))} หน่วย</span>
          <span>นอกช่วงวันที่ {number(imported.excluded.outsidePeriod)} · สินค้านอก ขย.11 {number(imported.excluded.otherReportGroup)} · บิลซ้ำที่รวมแล้ว {number(imported.excluded.duplicates)}</span>
        </div> : null}
        {jobs.length ? <>
          <div className="manual-bulk-actions">
            <button type="button" className="outline-button" onClick={() => setSelectedKeys(null)}>เลือกทั้งหมด</button>
            <button type="button" className="ghost-button" onClick={() => setSelectedKeys(jobs.filter((job) => !job.error).map((job) => job.key))}>เลือกเฉพาะงานที่ลอตพร้อม</button>
            <button type="button" className="ghost-button" onClick={() => setSelectedKeys([])}>ยกเลิกเลือกทั้งหมด</button>
          </div>
          <div className="manual-bulk-jobs">{jobs.map((job) => {
            const result = results.find((entry) => entry.key === job.key);
            const checked = selectedKeys === null || selectedKeys.includes(job.key);
            return <article className="manual-bulk-job" key={job.key}>
              <div className="manual-bulk-job-head">
                <label className="manual-bulk-check"><input type="checkbox" checked={checked} onChange={() => toggleJob(job)} />
                  <span><strong>สาขา {job.branchId} · {job.product.name}</strong><small>{job.product.code} · {job.product.pack}</small></span>
                </label>
                <span>ขาย {number(job.totalSold)} หน่วย · {number(job.sales.length)} บิล/แถว</span>
              </div>
              <details open={checked && Boolean(job.error)}>
                <summary>ลอตรับเข้า {number(job.lots.length)} รายการ · {job.error || "พร้อมสร้างรายงาน"}</summary>
                <p className="muted">ใช้จำนวนรับเข้าของสาขานี้ จำนวนต่อกล่องต้องเป็นหน่วยเดียวกับยอดขาย</p>
                <div className="manual-bulk-lot-labels" aria-hidden="true"><span>เลขลอต</span><span>วันที่รับ</span><span>กล่อง</span><span>หน่วย/กล่อง</span><span /></div>
                {job.lots.map((lot, index) => <div className="manual-bulk-lot" key={index}>
                  {[["batch", "text", "เลขลอต"], ["date", "date", "วันที่รับ"], ["boxes", "number", "กล่อง"], ["strips", "number", "หน่วยต่อกล่อง"]].map(([field, type, label]) => <input key={field} type={type} min={type === "number" ? 1 : undefined} step={type === "number" ? 1 : undefined} placeholder={label}
                    aria-label={`${label} ${job.branchId} ${job.product.code} ลอต ${index + 1}`} value={lot[field]}
                    onChange={(event) => updateLots(job, job.lots.map((entry, position) => position === index ? { ...entry, [field]: event.target.value } : entry))} />)}
                  <button type="button" className="ghost-button" aria-label={`ลบลอต ${index + 1} ${job.key}`} onClick={() => updateLots(job, job.lots.filter((_, position) => position !== index))}>ลบ</button>
                </div>)}
                <button type="button" className="outline-button" onClick={() => updateLots(job, [...job.lots, emptyLot()])}>เพิ่มลอต สาขา {job.branchId}</button>
                {lotOverrides[job.key] && importedLotMap.has(job.key) ? <button type="button" className="ghost-button" onClick={() => setLotOverrides((previous) => { const next = { ...previous }; delete next[job.key]; return next; })}>ใช้ลอตจาก CSV อีกครั้ง</button> : null}
              </details>
              {result ? <p className={result.status === "error" ? "manual-bulk-error-text" : "manual-bulk-success-text"} role="status">{result.status === "success" ? `สร้างแล้ว · ${number(result.totalSold)} หน่วย` : result.error}</p> : null}
            </article>;
          })}</div>
          <label className="manual-bulk-check manual-bulk-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            ตรวจสินค้า สาขา หน่วยยอดขาย และลอตของ {number(selectedJobs.length)} งานที่เลือกแล้ว
          </label>
          <div className="manual-bulk-actions">
            <button type="button" className="primary-button" disabled={!canBuild} onClick={() => handleBuild()}>สร้าง ขย.11 ทั้งชุด ({number(selectedJobs.length)} งาน)</button>
            {failures.length ? <button type="button" className="outline-button" disabled={!canBuild} onClick={() => handleBuild("failed")}>ลองใหม่เฉพาะงานที่ไม่สำเร็จ</button> : null}
            {run.cancelled && selectedJobs.some((job) => !results.some((result) => result.key === job.key)) ? <button type="button" className="outline-button" disabled={!canBuild} onClick={() => handleBuild("remaining")}>สร้างงานที่เหลือต่อ</button> : null}
          </div>
        </> : null}
      </fieldset>
      {busy || run.total || runError ? <div className="manual-bulk-run no-print" aria-live="polite">
        <span>{isReading ? "กำลังอ่านไฟล์…" : `${run.running ? "กำลังสร้าง" : run.cancelled ? "หยุดแล้ว" : "เสร็จแล้ว"} ${number(run.processed)} / ${number(run.total)} งาน · สำเร็จ ${number(successes.length)} · ไม่สำเร็จ ${number(failures.length)}`}</span>
        {run.running ? <><progress value={run.processed} max={run.total || 1} aria-label="ความคืบหน้าการสร้างรายงาน" /><button type="button" className="outline-button" onClick={() => { cancelRef.current = true; }}>หยุดหลังงานปัจจุบัน</button></> : null}
        {runError ? <p role="alert">{runError}</p> : null}
      </div> : null}
      {successes.length ? <>
        <div className="manual-bulk-actions no-print">
          <button type="button" className="primary-button" disabled={busy} onClick={onPrint}>พิมพ์ / บันทึก PDF ทั้งชุด ({number(successes.length)} งาน)</button>
          <button type="button" className="outline-button" disabled={busy} onClick={() => { const csv = buildBulkReportCsv(results); downloadText(csv.filename, csv.csvText); }}>ดาวน์โหลด CSV ทั้งชุด</button>
          <label>ตัวอย่างบนหน้าจอ <select aria-label="เลือกตัวอย่างรายงาน bulk" value={previewKey} onChange={(event) => setPreviewKey(event.target.value)}>
            <option value="">แสดงทั้งหมด</option>{successes.map((item) => <option key={item.key} value={item.key}>สาขา {item.meta.branchCode} · {item.meta.product}</option>)}
          </select></label>
          <span className="muted">พิมพ์รวมทุกงานที่สำเร็จ แม้กำลังดูตัวอย่างเพียงงานเดียว</span>
        </div>
        <section className="report-preview manual-bulk-preview" data-print-target="manual-bulk">
          {successes.map((item) => <div className={`manual-bulk-preview-group${previewKey && previewKey !== item.key ? " is-preview-hidden" : ""}`} key={item.key}>
            <h2 className="report-preview-title no-print">สาขา {item.meta.branchCode} · {item.meta.product}</h2>
            <ReportPages pages={item.pages} meta={item.meta} quantityLabel="จำนวน / ปริมาณ ที่ขาย (หน่วยรายงาน)" />
          </div>)}
        </section>
      </> : null}
    </div>
  );
}
