import { parseCsv } from "./csv.js";

const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).normalize("NFKC").toLowerCase().replace(/[\s_\-./()]+/g, "");
const ALIASES = {
  branch: ["branch", "branchCode", "branchId", "สาขา", "รหัสสาขา"],
  product: ["productCode", "ic_code", "code", "sku", "รหัสสินค้า", "productId", "product", "productName", "ชื่อสินค้า", "ชื่อยา"],
  date: ["saleDate", "sale_datetime_bangkok", "sale_date", "at_local", "date", "วันที่", "วันที่ขาย", "วันที่ขายยา"],
  qty: ["quantity", "qty", "qty_original", "จำนวน", "จำนวนขาย", "จำนวน(แผง)", "quantity_box"],
  bill: ["billNo", "bill_no", "bill", "เลขบิล", "เลขที่เอกสาร"],
  time: ["saleTime", "sale_time", "เวลาขาย", "เวลา"],
  unit: ["unit", "sale_unit", "raw_unit", "หน่วย"],
  batch: ["batch", "lot", "lotNo", "lot_no", "เลขที่ลอต", "เลขล็อต", "เลขครั้งที่ผลิต"],
  received: ["receivedDate", "received_date", "วันที่รับเข้า", "วันรับเข้า"],
  boxes: ["boxes", "จำนวนกล่อง", "กล่อง"],
  strips: ["strips", "unitsPerBox", "units_per_box", "แผงต่อกล่อง", "แผง/กล่อง"],
};

export function encodeCsv(rows) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return "\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\n");
}

export function normalizeBulkProducts(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const name = clean(row.tradeName);
    const originalPack = clean(row.packageSize || row.packagingSummary);
    const pack = originalPack.replace(/\s*\(factor=[^)]+\)/gi, "");
    return {
      id: clean(row.id), code: clean(row.productCode), name, pack,
      value: pack ? `${name} : ${pack}` : name,
      lookupValue: originalPack ? `${name} : ${originalPack}` : name,
      maker: clean(row.manufacturerName),
      groups: (Array.isArray(row.reportGroupCodes) ? row.reportGroupCodes : []).map((group) => clean(group).toUpperCase()),
    };
  }).filter((product) => product.id && product.name);
}

export function resolveBulkProduct(value, products) {
  const text = key(value);
  if (!text) return null;
  // Codes and IDs take precedence. Never guess a fuzzy name or package variant.
  const exact = products.filter((product) => key(product.id) === text || (product.code && key(product.code) === text));
  if (exact.length === 1) return exact[0];
  const byName = products.filter((product) => key(product.value) === text || key(product.lookupValue) === text || key(product.name) === text);
  return byName.length === 1 ? byName[0] : null;
}

export function normalizeBulkBranch(value, branches) {
  const text = clean(value);
  if (/^\d{1,3}$/.test(text)) {
    const code = text.padStart(3, "0");
    return branches.some((branch) => branch.value === code) ? code : "";
  }
  const match = branches.find((branch) => key(branch.label) === key(text) || key(branch.label.split(":").at(-1)) === key(text));
  return match?.value || "";
}

// Parse calendar values explicitly so Buddhist years, invalid days and Bangkok
// local timestamps do not depend on the browser's date parser or timezone.
export function normalizeBulkDate(value) {
  const text = clean(value);
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  let year, month, day;
  if (match) [, year, month, day] = match.map(Number);
  else {
    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[\s,].*)?$/);
    if (!match) return "";
    [, day, month, year] = match.map(Number);
  }
  if (year > 2400) year -= 543;
  const date = new Date(year, month - 1, day);
  if (year < 2000 || year > 2100 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeBulkSaleTimestamp(value) {
  const date = normalizeBulkDate(value);
  if (!date) return null;
  const suffix = clean(value).replace(/^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})/, "").trim();
  if (!suffix) return { date, time: "" };
  const match = suffix.match(/^(?:T|,\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, hour, minute, second = "0"] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  return { date, time: `${hour.padStart(2, "0")}:${minute}:${second.padStart(2, "0")}` };
}

function positiveInteger(value) {
  const text = clean(value).replace(/,/g, "");
  if (!/^\d+(?:\.0+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function detectColumns(header) {
  const normalized = header.map(key);
  return Object.fromEntries(Object.entries(ALIASES).map(([field, aliases]) => {
    let index = -1;
    for (const alias of aliases) {
      index = normalized.indexOf(key(alias));
      if (index >= 0) break;
    }
    return [field, index];
  }));
}

export function createBulkSource(text, name, id = name, kind = "sales") {
  let rows;
  if (/\.json$/i.test(name)) {
    if (kind !== "sales") throw new Error("ข้อมูลลอตต้องเป็น CSV แยกตามสาขา");
    const data = JSON.parse(String(text).replace(/^\uFEFF/, ""));
    const records = Array.isArray(data) ? data : data.rows;
    if (!Array.isArray(records)) throw new Error("JSON ต้องมี rows ของประวัติขาย (ใช้ POS_LOT_ASSIGNMENTS ได้)");
    rows = [["branchCode", "productCode", "saleDate", "quantity", "billNo", "unit"], ...records.map((row) => [
      row.branchCode ?? row.branch, row.productCode ?? row.code,
      row.saleDate ?? row.at_local, row.quantity ?? row.qty_original,
      row.billNo ?? row.bill, row.unit ?? row.raw_unit,
    ])];
  } else rows = parseCsv(text);
  const headerIndex = rows.slice(0, 30).findIndex((row) => {
    const columns = detectColumns(row);
    return kind === "sales" ? columns.date >= 0 && columns.qty >= 0 : columns.batch >= 0 && columns.received >= 0;
  });
  if (headerIndex < 0) throw new Error(kind === "sales" ? "ไม่พบหัวคอลัมน์วันที่ขายและจำนวนใน CSV" : "ไม่พบหัวคอลัมน์ batch และ received_date ใน CSV ลอต");
  const header = rows[headerIndex].map(clean);
  return { id, name, header, rows: rows.slice(headerIndex + 1), firstLine: headerIndex + 2,
    columns: detectColumns(header), branchId: "", productId: "", skipLegacyFirstRow: false };
}

// A combined CSV keeps the two established import formats in one table. Split
// by recordType before either importer sees a row from the other format.
export function createCombinedBulkSources(text, name, id = name) {
  const rows = parseCsv(text);
  const header = rows[0]?.map(clean) || [];
  const normalized = header.map(key);
  const required = ["recordType", "branchCode", "productCode", "saleDate", "quantity", "billNo", "batch", "received_date", "boxes", "units_per_box"];
  for (const column of required) {
    if (normalized.filter((value) => value === key(column)).length !== 1) {
      throw new Error(`ไฟล์รวมต้องมีคอลัมน์ ${column} เพียงหนึ่งคอลัมน์`);
    }
  }
  const typeIndex = normalized.indexOf(key("recordType"));
  const split = { SALE: [], LOT: [] };
  const lineNumbers = { SALE: [], LOT: [] };
  rows.slice(1).forEach((row, index) => {
    if (!row.some((value) => clean(value))) return;
    const type = clean(row[typeIndex]).toUpperCase();
    if (!Object.hasOwn(split, type)) throw new Error(`${name} แถว ${index + 2}: recordType ต้องเป็น SALE หรือ LOT`);
    split[type].push(row);
    lineNumbers[type].push(index + 2);
  });
  if (!split.SALE.length || !split.LOT.length) throw new Error("ไฟล์รวมต้องมีทั้งแถว SALE และ LOT");
  const make = (type, kind) => {
    const source = createBulkSource(encodeCsv([header, ...split[type]]), name, `${id}:${kind}`, kind);
    source.rowNumbers = lineNumbers[type];
    return source;
  };
  return { sales: make("SALE", "sales"), lots: make("LOT", "lots") };
}

async function readBulkText(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error("ไฟล์ต้องมีขนาดไม่เกิน 20 MB");
  const buffer = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { return new TextDecoder("windows-874", { fatal: true }).decode(buffer); }
}

export async function readCombinedBulkFile(file) {
  if (!/\.csv$/i.test(file.name)) throw new Error("ไฟล์รวมต้องเป็น CSV");
  return createCombinedBulkSources(await readBulkText(file), file.name, `${file.name}:${file.size}:${file.lastModified}`);
}

export async function readBulkFile(file, kind = "sales") {
  if (!/\.(csv|json)$/i.test(file.name) || (kind === "lots" && !/\.csv$/i.test(file.name))) throw new Error("เลือกไฟล์ CSV หรือ JSON ประวัติขายเท่านั้น");
  const text = await readBulkText(file);
  const source = createBulkSource(text, file.name, `${file.name}:${file.size}:${file.lastModified}`, kind);
  // Filenames are a convenience only; the user can override this before building.
  const branchMatch = file.name.match(/branch[_-]?(001|003|004|005)/i);
  if (branchMatch) source.branchId = branchMatch[1];
  return source;
}

export function importBulkSources({ sources, products, branches, kind = "sales", dateFrom = "", dateTo = "" }) {
  const groups = new Map();
  const errors = [];
  const excluded = { outsidePeriod: 0, otherReportGroup: 0, duplicates: 0 };
  const seenBills = new Map();
  let rowCount = 0;
  for (const source of sources) {
    const cell = (row, field) => clean(row[source.columns[field]]);
    for (let index = 0; index < source.rows.length; index += 1) {
      const row = source.rows[index];
      if (!row.some((value) => clean(value))) continue;
      if (index === 0 && source.skipLegacyFirstRow) continue;
      const location = `${source.name} แถว ${source.rowNumbers?.[index] ?? source.firstLine + index}`;
      const fail = (message) => errors.push({ location, message });
      const productValue = source.columns.product >= 0 ? cell(row, "product") : source.productId;
      const product = resolveBulkProduct(productValue, products);
      if (!product) { fail(`ไม่พบสินค้า หรือชื่อซ้ำหลายขนาดบรรจุ: ${productValue || "กรุณาเลือกสินค้าให้ไฟล์"}`); continue; }
      if (!product.groups.includes("KY11")) { excluded.otherReportGroup += 1; continue; }
      const branchValue = source.columns.branch >= 0 ? cell(row, "branch") : source.branchId;
      const branchId = normalizeBulkBranch(branchValue, branches);
      if (!branchId) { fail(`ไม่พบสาขา: ${branchValue || "กรุณาเลือกสาขาให้ไฟล์"}`); continue; }
      const groupKey = `${branchId}:${product.id}`;
      const dateValue = cell(row, kind === "sales" ? "date" : "received");
      const timeValue = kind === "sales" ? cell(row, "time") : "";
      const timestamp = kind === "sales" ? normalizeBulkSaleTimestamp(timeValue ? `${dateValue} ${timeValue}` : dateValue) : null;
      const date = kind === "sales" ? timestamp?.date : normalizeBulkDate(dateValue);
      if (!date) { fail("วัน/เวลาไม่ถูกต้อง (ใช้ YYYY-MM-DD หรือ DD/MM/YYYY/พ.ศ. พร้อมเวลาไทย HH:mm:ss หากมี)"); continue; }
      if (kind === "sales" && ((dateFrom && date < dateFrom) || (dateTo && date > dateTo))) { excluded.outsidePeriod += 1; continue; }
      let record;
      if (kind === "sales") {
        const qty = positiveInteger(cell(row, "qty"));
        if (!qty) { fail("จำนวนขายต้องเป็นจำนวนเต็มบวกในหน่วยที่ใช้กับรายงานเดิม; ตรวจรายการคืน/เศษหน่วยก่อนนำเข้า"); continue; }
        const bill = cell(row, "bill");
        const unit = cell(row, "unit");
        record = { date, time: timestamp.time, qty, bill, unit, source: location };
        if (bill) {
          const identity = `${groupKey}:${bill}`;
          const previous = seenBills.get(identity);
          if (previous) {
            if (previous.date === date && previous.time === record.time && previous.qty === qty && previous.unit === unit) excluded.duplicates += 1;
            else fail(`เลขบิล ${bill} ซ้ำแต่ข้อมูลต่างกัน; ตรวจรายการก่อนรวมยอด`);
            continue;
          }
          seenBills.set(identity, record);
        }
      } else {
        const batch = cell(row, "batch");
        const boxes = positiveInteger(cell(row, "boxes"));
        const strips = positiveInteger(cell(row, "strips"));
        if (!batch || !boxes || !strips) { fail("ลอตต้องมี batch, boxes และ strips/units_per_box เป็นจำนวนเต็มบวก"); continue; }
        record = { batch, date, boxes, strips, source: location };
      }
      if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, branchId, product, sales: [], lots: [], sources: new Set() });
      const group = groups.get(groupKey);
      if (kind === "sales") group.sales.push(record);
      else group.lots.push(record);
      group.sources.add(source.name);
      rowCount += 1;
    }
  }
  return { groups: [...groups.values()].map((group) => ({ ...group, sources: [...group.sources], totalSold: group.sales.reduce((sum, sale) => sum + sale.qty, 0) }))
    .sort((left, right) => left.branchId.localeCompare(right.branchId) || left.product.value.localeCompare(right.product.value, "th")), errors, excluded, rowCount };
}

export function validateBulkLots(lots, totalSold) {
  if (!lots.length) return "ยังไม่มีลอตรับเข้าของสาขานี้";
  let capacity = 0;
  for (const lot of lots) {
    if (!clean(lot.batch) || !normalizeBulkDate(lot.date) || !positiveInteger(lot.boxes) || !positiveInteger(lot.strips)) return "กรอกเลขลอต วันที่รับ จำนวนกล่อง และหน่วยต่อกล่องให้ครบ";
    capacity += Number(lot.boxes) * Number(lot.strips);
  }
  if (!Number.isSafeInteger(capacity)) return "จำนวนรับเข้าสูงเกินขอบเขตที่รองรับ";
  if (capacity > 100000) return "ลอตรวมเกิน 100,000 หน่วย โปรดแบ่งชุดข้อมูล";
  return capacity < totalSold ? `ลอตไม่พอ: รับ ${capacity.toLocaleString("th-TH")} / ขาย ${totalSold.toLocaleString("th-TH")} หน่วย` : "";
}

export function buildSalesTemplate() {
  return encodeCsv([["branchCode", "productCode", "saleDate", "quantity", "billNo", "unit"]]);
}

export function buildLotsTemplate(groups = []) {
  return encodeCsv([["branchCode", "productCode", "batch", "received_date", "boxes", "units_per_box"], ...groups.map((group) => [group.branchId, group.product.code || group.product.id, "", "", "", ""])]);
}
