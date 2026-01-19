import { detectPatientColumns, detectSalesColumns, expandSalesRows, parseCsv, pick } from "./csv";
import { isDateLike, parseProductLine, parseThaiDateLoose, toNumberSafe } from "./utils";
import { getBranchNameOnly } from "../../data/branches";

const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

export function buildReport({
  lots,
  salesCsvText,
  patientsCsvText,
  productName,
  maker,
  sku,
  branchId,
}) {
  const salesRows = parseCsv(salesCsvText || "");
  const patientRows = parseCsv(patientsCsvText || "");
  const salesMeta = detectSalesColumns(salesRows);

  const sales = [];
  let totalSold = 0;

  for (let i = salesMeta.startRow; i < salesRows.length; i += 1) {
    const row = salesRows[i];
    if (!row) continue;
    const dateValue = pick(row, salesMeta.dateCol);
    const qtyValue = pick(row, salesMeta.qtyCol);
    if (!dateValue) continue;

    const date = isDateLike(dateValue) ? parseThaiDateLoose(dateValue) : new Date(dateValue);
    const qty = toNumberSafe(qtyValue);
    const okDate =
      Number.isFinite(date.getTime()) && date.getFullYear() >= 2000 && date.getFullYear() <= 2100;
    const okQty = Number.isFinite(qty) && qty >= 1 && qty <= salesMeta.maxQty && Math.floor(qty) === qty;

    if (okDate && okQty) {
      sales.push({ date, qty });
      totalSold += qty;
    }
  }

  const expanded = expandSalesRows(sales);
  sales.length = 0;
  sales.push(...expanded);
  sales.sort((a, b) => a.date - b.date);

  const patientMeta = detectPatientColumns(patientRows);
  const patients = [];
  for (let i = patientMeta.startRow; i < patientRows.length; i += 1) {
    const pid = pick(patientRows[i], patientMeta.pidCol);
    const name = pick(patientRows[i], patientMeta.nameCol);
    if (pid && name) {
      patients.push({ pid, name, next: new Date(0) });
    }
  }

  if (!patients.length) {
    return { error: "ไฟล์รายชื่อผู้ป่วยว่างหรือคอลัมน์ไม่ตรง", pages: [] };
  }

  const pickPatient = (onDate) => {
    const pool = patients.filter((patient) => patient.next <= onDate);
    if (!pool.length) {
      return patients.slice().sort((a, b) => a.next - b.next)[0];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const lotsOrdered = lots
    .map((lot) => ({
      ...lot,
      boxes: Number(lot.boxes || 1),
      strips: Number(lot.strips || 0),
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const totalFromLots = lotsOrdered.reduce((sum, lot) => sum + lot.boxes * lot.strips, 0);

  if (totalSold > totalFromLots) {
    const fallbackStrips = lotsOrdered.length
      ? Number(lotsOrdered[lotsOrdered.length - 1].strips || 50)
      : 50;
    const deficit = totalSold - totalFromLots;
    const needBoxes = Math.ceil(deficit / fallbackStrips);
    return {
      pages: [],
      warning: {
        totalSold,
        totalFromLots,
        deficit,
        needBoxes,
        stripsPerBox: fallbackStrips,
      },
    };
  }

  const expandedLots = [];
  for (const lot of lotsOrdered) {
    const boxes = Math.max(1, Number(lot.boxes || 1));
    for (let i = 1; i <= boxes; i += 1) {
      expandedLots.push({
        ...lot,
        boxes: 1,
        _boxIndex: i,
        batch: `${lot.batch || ""} (${i})`,
      });
    }
  }

  if (!expandedLots.length) {
    return { pages: [] };
  }

  let lotIndex = 0;
  let lotRemain = expandedLots[0].strips;
  const pages = [{ lot: expandedLots[0], rows: [] }];

  for (const sale of sales) {
    while (sale.qty > lotRemain && lotIndex < expandedLots.length - 1) {
      lotIndex += 1;
      lotRemain = expandedLots[lotIndex].strips;
      pages.push({ lot: expandedLots[lotIndex], rows: [] });
    }

    const patient = pickPatient(sale.date);
    patient.next = addDays(sale.date, 3 * sale.qty);

    pages.at(-1).rows.push({
      date: sale.date,
      qty: sale.qty,
      name: patient.name,
      pid: patient.pid,
      note: "",
    });

    lotRemain -= sale.qty;

    if (lotRemain === 0 && lotIndex < expandedLots.length - 1) {
      lotIndex += 1;
      lotRemain = expandedLots[lotIndex].strips;
      pages.push({ lot: expandedLots[lotIndex], rows: [] });
    }
  }

  const parsedProduct = parseProductLine(productName || "");
  const meta = {
    product: parsedProduct.name,
    packSize: parsedProduct.pack,
    maker,
    sku,
    branchNameOnly: getBranchNameOnly(branchId),
  };

  return { pages, meta, totals: { totalSold, totalFromLots } };
}
