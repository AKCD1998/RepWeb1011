import { encodeCsv, normalizeBulkDate } from "./bulkValues.js";

const text = (value) => String(value ?? "").trim();
const documentKey = (value) => text(value).toUpperCase().replace(/[\s\-_/.,]+/g, "");
const lotKey = (value) => text(value).toUpperCase().replace(/^LOT\s*/i, "");
const meaningfulLot = (value) => !["", "1", "0", "UNKNOWN", "N/A"].includes(lotKey(value));
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const quantity = (value) => Math.round(Number(value) * 1e6) / 1e6;
const packagedUnit = (unit) => text(unit).match(/^(\d+(?:\.\d+)?)\s*ชิ้น$/);
const physicalUnit = (unit) => text(unit).match(/^(แผง|ซอง|ขวด|หลอด|กระปุก|กล่อง|แพ็ก|แผ่น|เม็ด|แคปซูล|ตลับ|ใบ|ชิ้น)(?=$|\s|\d)/)?.[1] || "";
const formatNumber = (value) => Number(value).toLocaleString("th-TH", { maximumFractionDigits: 6 });
const isReportDraft = (record) => ["report_draft", "prior_draft"].includes(text(record.evidence_type ?? record.evidenceType))
  || /^(?:KY9|KY10|KY11)_.*DRAFT.*\.pdf$/i.test(text(record.source_file ?? record.file).split(/[\\/]/).pop());
const hasBatchDetails = (row) => Boolean(meaningfulLot(row.lot) || row.manufacturedDate || row.expiry);
const hasScannedBatchDetails = (row) => Boolean(row.sourceId && hasBatchDetails(row));
export const PURCHASE_BRANCHES = ["000", "001", "003", "004", "005"];
export const PURCHASE_BRANCH_NAMES = {
  "000": "สำนักงานใหญ่ บริษัท เอสซี กรุ๊ป (1989) จำกัด", "001": "ศิริชัยเภสัช สาขาตลาดแม่กลอง",
  "003": "ศิริชัยเภสัช สาขาวัดช่องลม", "004": "ศิริชัยเภสัช สาขาตลาดบางน้อย", "005": "ศิริชัยเภสัช สาขาถนนเอกชัยสมุทรสาคร",
};

export function normalizePurchaseSources(input, edits = {}) {
  const records = Array.isArray(input) ? input : input?.source_records;
  if (!Array.isArray(records)) throw new Error("ไฟล์ข้อมูลซื้อต้องมี source_records จากเอกสารสแกน");
  const sources = [], excluded = [], excludedEvidence = [], issues = [];
  records.forEach((record, index) => {
    const id = text(record.id) || `source-${index + 1}`;
    const row = { ...record, ...edits[id] };
    // Older bundles contained a generated Iyafin report as a source. A report is
    // never original scan evidence, even when its receipt exists in StockDay.
    if (isReportDraft(record) || isReportDraft(row)) { excludedEvidence.push({ id, name: row.name, file: row.source_file ?? row.file, reason: "เอกสารรายงานเดิม ไม่ใช่สแกนต้นฉบับ" }); return; }
    const kind = text(row.kind);
    if (["non_drug", "dietary_supplement", "other"].includes(kind)) { excluded.push({ id, name: row.name, kind }); return; }
    const source = {
      id, code: text(row.code ?? row.productCode), name: text(row.name ?? row.productName),
      kind, lot: text(row.lot), invoiceNo: text(row.invoice_no ?? row.invoiceNo),
      invoiceDate: normalizeBulkDate(row.invoice_date ?? row.invoiceDate),
      supplier: text(row.source_supplier ?? row.supplier),
      sourceQuantity: Number(row.source_qty ?? row.sourceQuantity), sourceUnit: text(row.source_unit ?? row.sourceUnit),
      baseQuantity: Number(row.cap_qty ?? row.baseQuantity), baseUnit: text(row.cap_unit ?? row.baseUnit),
      conversionStatus: text(row.quantity_conversion_status ?? row.conversionStatus), pack: text(row.pack),
      file: text(row.source_file ?? row.file),
      evidenceType: "original_scan",
      manufacturedDate: normalizeBulkDate(row.mfg ?? row.manufacturedDate), expiry: normalizeBulkDate(row.exp ?? row.expiry),
      receiptDocuments: (row.receiptDocuments || []).map(text).filter(Boolean),
      receiptHints: (row.receiptHints || []).map(text).filter(Boolean),
      candidateCodes: (row.candidateCodes || []).map((candidate) => ({ code: text(candidate.code), name: text(candidate.name), barcode: text(candidate.barcode) })).filter((candidate) => candidate.code),
      mappingNote: text(row.mappingNote),
    };
    source.issues = [];
    if (!source.code) source.issues.push("รอจับคู่รหัสสินค้า");
    if (!source.name || !hasBatchDetails(source) || !source.invoiceDate || !positive(source.sourceQuantity) || !source.sourceUnit) source.issues.push("ข้อมูลซื้อจากเอกสารยังไม่ครบ");
    if (kind !== "drug") source.issues.push("รอยืนยันประเภทสินค้าเป็นยา");
    if (sources.some((other) => other.id === id)) throw new Error(`รหัสข้อมูลซื้อซ้ำ: ${id}`);
    sources.push(source);
    if (source.issues.length) issues.push({ sourceId: id, name: source.name, messages: source.issues });
  });
  return { sources, excluded, excludedEvidence, issues };
}

function normalizeMovements(input) {
  if (!input || !Array.isArray(input.receipts) || !Array.isArray(input.transfers)) throw new Error("ไฟล์รับและโอนต้องมี receipts และ transfers จาก Movement Trace");
  const events = [], errors = [], seen = new Map();
  let duplicates = 0, cancelled = 0;
  [...input.receipts, ...input.transfers].forEach((entry, index) => {
    if (["3", "VOID", "CANCELLED", "CANCELED"].includes(text(entry.documentStatus).toUpperCase())) { cancelled += 1; return; }
    const event = {
      id: text(entry.eventId), type: text(entry.type), date: normalizeBulkDate(entry.date), time: text(entry.time),
      doc: text(entry.documentNo), code: text(entry.productCode), name: text(entry.productName),
      from: text(entry.branchFrom), to: text(entry.branchTo), supplier: text(entry.supplierName),
      invoice: text(entry.invoiceReference), references: [entry.lineReference, entry.headerReference].map(documentKey).filter(Boolean),
      qty: Number(entry.originalQuantity), unit: text(entry.originalUnit), baseQty: Number(entry.baseQuantity),
      factor: Number(entry.stockFactor), lot: meaningfulLot(entry.lot) ? text(entry.lot) : "", line: entry.lineNo,
      freeGoods: entry.type === "supplier_receipt" && entry.unitPrice === 0 && entry.lineAmount === 0,
      documentType: text(entry.documentType), sourceTable: text(entry.sourceTable),
    };
    const valid = event.id && event.doc && event.code && event.date && event.unit && positive(event.qty) && positive(event.baseQty)
      && PURCHASE_BRANCHES.includes(event.to) && (event.type === "supplier_receipt" || (event.type === "transfer" && PURCHASE_BRANCHES.includes(event.from) && event.from !== event.to));
    if (!valid) { errors.push({ eventId: event.id || `แถว ${index + 1}`, message: "ข้อมูลรับ/โอนไม่ครบ วันที่ สาขา หน่วย หรือจำนวนไม่ถูกต้อง" }); return; }
    // Native document-line IDs distinguish genuine repeated lines, including free goods.
    // Metadata-only changes (e.g. native surrogate ID) never create another receipt.
    const signature = JSON.stringify(event);
    if (seen.has(event.id)) {
      if (seen.get(event.id) !== signature) errors.push({ eventId: event.id, message: "เลขรายการต้นทางซ้ำแต่ข้อมูลขัดกัน" });
      else duplicates += 1;
      return;
    }
    seen.set(event.id, signature);
    events.push(event);
  });
  // Ada records the same TS transfer as type 8 (dispatch) and type 7 (receipt).
  // Keep the receiving entry once, with its date and both native IDs as evidence.
  const pairs = new Map(), transfers = [], mirrored = [];
  for (const event of events) {
    const family = event.sourceTable.replace(/(?:HD|DT)$/, "");
    if (event.type !== "transfer" || family !== "TCNTPdtTnf" || !["7", "8"].includes(event.documentType) || event.line == null) { transfers.push(event); continue; }
    const key = JSON.stringify([family, event.doc, event.code, String(event.line)]);
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(event);
  }
  for (const group of pairs.values()) {
    const inbound = group.filter((event) => event.documentType === "7"), outbound = group.filter((event) => event.documentType === "8");
    if (inbound.length === 1 && outbound.length === 1) {
      const receive = inbound[0], send = outbound[0];
      const conflicts = ["from", "to", "qty", "unit", "baseQty"].some((field) => receive[field] !== send[field]) || (receive.lot && send.lot && lotKey(receive.lot) !== lotKey(send.lot));
      if (conflicts || receive.date < send.date) errors.push({ eventId: receive.id, message: "รายการรับและจ่ายของใบโอนเดียวกันขัดกัน รอตรวจจำนวน หน่วย สาขา ล็อต หรือวันที่" });
      transfers.push({ ...receive, pairedEventIds: [send.id] });
      mirrored.push({ documentNo: receive.doc, productCode: receive.code, retainedEventId: receive.id, pairedEventId: send.id });
    } else {
      if (inbound.length > 1 || outbound.length > 1) errors.push({ eventId: group[0].id, message: "ใบโอนมีรายการรับหรือจ่ายซ้ำในบรรทัดเดียวกัน" });
      transfers.push(...group.map((event) => ({ ...event, dispatchOnly: event.documentType === "8" && !inbound.length })));
    }
  }
  return { events: transfers, errors, duplicates, cancelled, mirrored };
}

function purchaseQuantityUnits(sources, events) {
  const units = new Map();
  for (const code of new Set(events.map((event) => event.code))) {
    const productEvents = events.filter((event) => event.code === code);
    // A plain unit on a native one-to-one quantity identifies what a counted pack contains.
    // Do not use receipt stockFactor here: some receipts store 1 while baseQty is already expanded.
    const native = new Set(productEvents.filter((event) => Math.abs(event.qty - event.baseQty) < 1e-6 && physicalUnit(event.unit) === event.unit).map((event) => event.unit));
    if (native.size > 1) native.delete("ชิ้น");
    if (native.size === 1) { units.set(code, [...native][0]); continue; }
    if (native.size > 1) continue;
    const productSources = sources.filter((source) => source.code === code);
    const verified = new Set(productSources.filter((source) => ["EXPLICIT_PRIOR_FACTS", "SOURCE_PACK"].includes(source.conversionStatus)).map((source) => physicalUnit(source.baseUnit)).filter(Boolean));
    if (verified.size === 1) { units.set(code, [...verified][0]); continue; }
    if (verified.size > 1) continue;
    const counts = new Set(productEvents.map((event) => Number(packagedUnit(event.unit)?.[1])).filter(positive));
    const scanned = new Set(productSources.flatMap((source) => [...source.pack.matchAll(/(\d+(?:\.\d+)?)\s*(แผง|ซอง|ขวด|หลอด|กระปุก|กล่อง|แพ็ก|แผ่น|เม็ด|แคปซูล|ตลับ|ใบ|ชิ้น)/g)]).filter((match) => counts.has(Number(match[1]))).map((match) => match[2]));
    if (scanned.size === 1) units.set(code, [...scanned][0]);
  }
  return units;
}

export function formatPurchaseQuantity(row) {
  const pack = packagedUnit(row.unit);
  if (!pack) return `${formatNumber(row.qty)} ${row.unit}`;
  const count = Number(pack[1]);
  // The native base quantity is authoritative; never expand an already expanded count again.
  if (!positive(row.baseQty) || Math.abs(quantity(row.qty * count) - row.baseQty) > 1e-6) return `${formatNumber(row.qty)} × ${formatNumber(count)} ชิ้น (รอตรวจหน่วย)`;
  return `${formatNumber(row.baseQty)} ${row.quantityUnit || "ชิ้น"}`;
}

export function reconcilePurchases({ sourceInput, movementInput, edits = {}, receiptMatches = {}, transferMatches = {}, dateFrom = "", dateTo = "" }) {
  const normalized = normalizePurchaseSources(sourceInput, edits);
  const movement = normalizeMovements(movementInput);
  const sources = normalized.sources;
  const codes = new Set(sources.map((source) => source.code).filter(Boolean));
  const events = movement.events.filter((event) => codes.has(event.code));
  const quantityUnits = purchaseQuantityUnits(sources, events);
  for (const event of events) event.quantityUnit = quantityUnits.get(event.code) || "";
  const productNames = new Map(sources.filter((source) => source.code && source.name).map((source) => [source.code, source.name]));
  for (const event of events) if (event.name) productNames.set(event.code, event.name);
  const receipts = new Map();
  for (const event of events.filter((event) => event.type === "supplier_receipt")) {
    const key = `${event.to}|${event.doc}|${event.code}`;
    if (!receipts.has(key)) receipts.set(key, { key, code: event.code, doc: event.doc, date: event.date, to: event.to, invoice: event.invoice, supplier: event.supplier, events: [] });
    receipts.get(key).events.push(event);
  }
  const receiptJobs = [], audit = [], rows = [], pools = new Map();
  const poolKey = (branch, sourceId) => `${branch}|${sourceId}`;
  const addPool = (branch, source, amount, date, proof) => {
    const key = poolKey(branch, source.id);
    const current = pools.get(key) || { branch, source, available: 0, date, proof };
    current.available = quantity(current.available + amount);
    current.proof = current.proof && proof;
    pools.set(key, current);
  };
  const rowFor = (event, source, status, problems = [], receiptDoc = "") => ({
    id: event.id, branch: event.to, date: event.date, supplier: event.type === "transfer" ? PURCHASE_BRANCH_NAMES[event.from] : event.supplier || source?.supplier || "",
    productCode: event.code, productName: source?.name || event.name || productNames.get(event.code) || event.code,
    lot: source?.lot || "", manufacturedDate: source?.manufacturedDate || "", expiry: source?.expiry || "",
    qty: event.qty, unit: event.unit, baseQty: event.baseQty, quantityUnit: event.quantityUnit,
    documentNo: event.doc, invoiceNo: source?.invoiceNo || event.invoice, receiptDocument: receiptDoc,
    sourceId: source?.id || "", sourceFile: source?.file || "", status,
    issues: [...new Set([...(source?.issues || []), ...problems])], type: event.type,
    freeGoods: event.freeGoods,
    pairedEventIds: event.pairedEventIds || [],
  });
  const tasks = [];
  for (const group of receipts.values()) {
    const candidates = sources.filter((source) => source.code === group.code);
    const explicit = candidates.filter((source) => (source.invoiceNo && documentKey(source.invoiceNo) === documentKey(group.invoice))
      || source.receiptDocuments.some((doc) => documentKey(doc) === documentKey(group.doc)));
    const overridden = Object.hasOwn(receiptMatches, group.key);
    let source = overridden ? candidates.find((candidate) => candidate.id === receiptMatches[group.key]) : explicit.length === 1 ? explicit[0] : null;
    let status = receiptMatches[group.key] && source ? "manual" : source ? "matched" : "pending";
    const problems = [];
    const totalOriginal = quantity(group.events.reduce((sum, event) => sum + event.qty, 0));
    const totalBase = quantity(group.events.reduce((sum, event) => sum + event.baseQty, 0));
    if (!source && !overridden) {
      const proposed = candidates.filter((candidate) => {
        const distance = Math.abs((Date.parse(group.date) - Date.parse(candidate.invoiceDate)) / 86400000);
        return candidate.receiptHints.some((doc) => documentKey(doc) === documentKey(group.doc)) || (distance <= 7 && (candidate.sourceQuantity === totalOriginal || (["EXPLICIT_PRIOR_FACTS", "SOURCE_PACK"].includes(candidate.conversionStatus) && candidate.baseQuantity === totalBase)));
      });
      if (proposed.length === 1) { source = proposed[0]; status = "proposed"; problems.push("จับคู่จากสินค้า วันที่ และจำนวน ต้องยืนยันเอกสารซื้อ"); }
      else if (explicit.length > 1) problems.push("เอกสารเดียวมีหลายล็อต รอเลือกล็อตตามรายการจริง");
    }
    // Ignore unrelated historic receipts, but keep every receipt that could link to a supplied scan.
    const earliest = candidates.map((candidate) => candidate.invoiceDate).filter(Boolean).sort()[0];
    if (!source && (!earliest || group.date < earliest)) { audit.push({ documentNo: group.doc, code: group.code, reason: "รับก่อนช่วงเอกสารสแกนที่นำเข้า" }); continue; }
    if (source) {
      const exactUnit = group.events.every((event) => event.unit === source.sourceUnit);
      const hasBaseConversion = ["EXPLICIT_PRIOR_FACTS", "SOURCE_PACK"].includes(source.conversionStatus);
      if ((exactUnit && totalOriginal !== source.sourceQuantity) || (hasBaseConversion && positive(source.baseQuantity) && totalBase !== source.baseQuantity)) problems.push("จำนวนในระบบกับเอกสารสแกนต่างกัน รอตรวจหน่วย/สินค้าแถม");
      if (!exactUnit && !hasBaseConversion) problems.push("หน่วยรับกับหน่วยในเอกสารต่างกัน รอตรวจอัตราแปลงหน่วย");
      if (group.date < source.invoiceDate) problems.push("วันที่รับในระบบก่อนวันที่เอกสารซื้อ");
      if (group.events.some((event) => event.lot && lotKey(event.lot) !== lotKey(source.lot))) problems.push("ล็อตในระบบต่างจากเอกสารสแกน");
    }
    const job = { ...group, candidates, sourceId: source?.id || "", status, issues: problems, source };
    receiptJobs.push(job);
    tasks.push({ type: "receipt", date: group.date, job });
  }
  const sourceUses = new Map();
  for (const job of receiptJobs.filter((job) => job.source)) sourceUses.set(job.sourceId, (sourceUses.get(job.sourceId) || 0) + 1);
  for (const job of receiptJobs) if (sourceUses.get(job.sourceId) > 1) job.issues.push("เอกสารซื้อชุดนี้เชื่อมกับใบรับมากกว่าหนึ่งใบ รอตรวจการรับซ้ำ/แบ่งรับ");
  for (const event of events.filter((event) => event.type === "transfer")) tasks.push({ type: "transfer", date: event.date, event });
  // Receipts precede same-day transfers; HQ dispatch precedes inter-branch dispatch.
  tasks.sort((a, b) => a.date.localeCompare(b.date) || (a.type === "receipt" ? 0 : a.event.from === "000" ? 1 : 2) - (b.type === "receipt" ? 0 : b.event.from === "000" ? 1 : 2) || text(a.event?.doc).localeCompare(text(b.event?.doc)));
  for (const task of tasks) {
    if (task.type === "receipt") {
      const { job } = task;
      job.events.forEach((event) => rows.push(rowFor(event, job.source, job.status, job.issues, job.doc)));
      if (job.source) addPool(job.to, job.source, job.events.reduce((sum, event) => sum + event.baseQty, 0), job.date, ["matched", "manual"].includes(job.status) && !job.issues.length && !job.source.issues.length);
      continue;
    }
    const event = task.event;
    const candidates = sources.filter((source) => source.code === event.code);
    const earliest = candidates.map((source) => source.invoiceDate).filter(Boolean).sort()[0];
    if (!earliest || event.date < earliest) { audit.push({ eventId: event.id, documentNo: event.doc, code: event.code, reason: "โอนก่อนช่วงเอกสารสแกนที่นำเข้า" }); continue; }
    const possiblePools = [...pools.values()].filter((pool) => pool.branch === event.from && pool.source.code === event.code && pool.available + 1e-6 >= event.baseQty && pool.date <= event.date);
    possiblePools.sort((a, b) => b.date.localeCompare(a.date) || a.source.id.localeCompare(b.source.id));
    const reviewIds = [event.id, ...(event.pairedEventIds || [])];
    const selectedSources = [...new Set(reviewIds.filter((id) => Object.hasOwn(transferMatches, id)).map((id) => transferMatches[id]))];
    const overridden = selectedSources.length > 0;
    let source = selectedSources.length === 1 ? candidates.find((candidate) => candidate.id === selectedSources[0]) : null;
    let status = source ? "manual" : "pending";
    const problems = [];
    if (selectedSources.length > 1) problems.push("คู่รับ/จ่ายใบโอนนี้เคยยืนยันคนละล็อต รอเลือกล็อตให้ตรงกัน");
    if (event.dispatchOnly) problems.push("พบเฉพาะฝั่งจ่ายโอน ยังต้องตรวจใบรับและวันที่รับจริง");
    if (!source && !overridden && event.lot) {
      const exactLots = candidates.filter((candidate) => lotKey(candidate.lot) === lotKey(event.lot));
      if (exactLots.length === 1) { source = exactLots[0]; status = "matched"; }
    }
    if (!source && !overridden && possiblePools.length) {
      source = possiblePools[0].source;
      status = "proposed";
      problems.push(possiblePools.length > 1 ? "มีหลายล็อตที่เป็นไปได้ รอยืนยันล็อตตามใบโอน" : "ใบโอนไม่ระบุล็อต เสนอล็อตจากข้อมูลรับเข้าต้นทาง");
    }
    if (source) {
      const pool = pools.get(poolKey(event.from, source.id));
      if (!pool || pool.date > event.date || pool.available + 1e-6 < event.baseQty) problems.push("ยอดรับที่เชื่อมกับล็อตนี้ไม่ครอบคลุมจำนวนโอน รอตรวจเอกสารต้นทาง");
      if (pool && !pool.proof) problems.push("ต้นทางมีการจับคู่ที่ยังรอตรวจ");
      if (pool) pool.available = quantity(pool.available - event.baseQty);
      addPool(event.to, source, event.baseQty, event.date, ["matched", "manual"].includes(status) && !problems.length && !source.issues.length);
    } else problems.push("รอเลือกล็อต/เอกสารซื้อที่ตรงกับรายการรับโอน");
    rows.push(rowFor(event, source, status, problems));
  }
  const inPeriod = rows.filter((row) => (!dateFrom || row.date >= dateFrom) && (!dateTo || row.date <= dateTo));
  inPeriod.forEach((row) => { row.ready = Boolean(["matched", "manual"].includes(row.status) && !row.issues.length && hasScannedBatchDetails(row) && row.supplier && !movement.errors.length); });
  inPeriod.sort((a, b) => a.branch.localeCompare(b.branch) || a.date.localeCompare(b.date) || a.documentNo.localeCompare(b.documentNo) || a.id.localeCompare(b.id));
  // Scope belongs to the imported scans, not every purchase of the same SKU.
  // Retain unmatched events separately for mapping; never print/export them as KY9.
  const scoped = inPeriod.filter(hasScannedBatchDetails);
  const unlinkedMovements = inPeriod.filter((row) => !hasScannedBatchDetails(row));
  const branches = PURCHASE_BRANCHES.map((branch) => ({ branch, name: PURCHASE_BRANCH_NAMES[branch], rows: scoped.filter((row) => row.branch === branch) }));
  return { sources, sourceIssues: normalized.issues, excluded: normalized.excluded, excludedEvidence: normalized.excludedEvidence, receiptJobs, rows: scoped, unlinkedMovements, branches, audit, errors: movement.errors,
    duplicates: movement.duplicates, mirroredTransfers: movement.mirrored, cancelled: movement.cancelled, capturedAt: movementInput.capturedAt || "", dateFrom: movementInput.dateFrom, dateTo: movementInput.dateTo };
}

export function purchaseRowsCsv(rows) {
  return encodeCsv([["branchCode", "receivedDate", "supplier", "productCode", "productName", "lot", "quantity", "unit", "documentNo", "invoiceNo", "sourceFile", "status", "reviewNotes", "manufacturedDate", "expiryDate", "baseQuantity", "baseUnit", "reportQuantity"],
    ...rows.filter(hasScannedBatchDetails).map((row) => [row.branch, row.date, row.supplier, row.productCode, row.productName, row.lot, row.qty, row.unit, row.documentNo, row.invoiceNo, row.sourceFile, row.ready ? "ready" : row.status, row.issues.join("; "), row.manufacturedDate, row.expiry, row.baseQty, row.quantityUnit, formatPurchaseQuantity(row)])]);
}

export function selectPurchaseDocumentRows(rows, { readyOnly = false } = {}) {
  return rows.filter((row) => (!readyOnly || row.ready) && hasScannedBatchDetails(row));
}

export function purchaseLotGapsCsv(result) {
  return encodeCsv([["branchCode", "receivedDate", "productCode", "productName", "documentNo", "quantity", "unit", "reason", "nearbyReceiptDocumentsForLookup", "nearbyInvoiceReferencesForLookup", "scannedLotsForReference", "lookupNote", "reportQuantity"],
    ...(result.unlinkedMovements || result.rows.filter((row) => !hasScannedBatchDetails(row))).map((row) => {
      const prior = result.receiptJobs.filter((job) => job.code === row.productCode && job.date <= row.date).sort((a, b) => b.date.localeCompare(a.date));
      const nearby = prior.filter((job) => job.date === prior[0]?.date);
      const scanned = result.sources.filter((source) => source.code === row.productCode);
      return [row.branch, row.date, row.productCode, row.productName, row.documentNo, row.qty, row.unit,
        row.type === "supplier_receipt" ? "ใบรับยังไม่เชื่อมกับใบสแกน" : "เส้นทางรับโอนยังไม่เชื่อมกับล็อตที่มีจำนวนรองรับ",
        [...new Set(nearby.map((job) => job.doc))].join("; "), [...new Set(nearby.map((job) => job.invoice).filter(Boolean))].join("; "),
        scanned.map((source) => `${source.lot} · ${source.invoiceNo || source.invoiceDate}`).join("; "),
        "เลขใบรับใกล้วันโอนใช้ค้นเอกสารเพิ่มเติม ยังไม่ได้ยืนยันว่าเป็นล็อตของใบโอนนี้", formatPurchaseQuantity(row)];
    })]);
}
