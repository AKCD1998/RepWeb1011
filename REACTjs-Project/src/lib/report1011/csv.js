import { stripBOM, isDateLike, toNumberSafe } from "./utils";

export const parseCsv = (text) => {
  const clean = stripBOM(text || "");
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    const next = clean[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char === "\r") {
      // skip
    } else {
      value += char;
    }
  }
  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
};

export const pick = (row, index) => (row && row[index] ? String(row[index]).trim() : "");

export const detectSalesColumns = (rows) => {
  const max = Math.min(rows.length, 50);
  const maxQtyPerRow = 500;
  let best = null;

  for (let i = 0; i < max; i += 1) {
    const row = rows[i] || [];
    for (let j = 0; j < row.length; j += 1) {
      if (!isDateLike(row[j])) continue;

      const candidates = [];
      for (let k = 0; k < row.length; k += 1) {
        if (k === j) continue;
        const val = toNumberSafe(row[k]);
        if (Number.isFinite(val) && val >= 1 && val <= maxQtyPerRow && Math.floor(val) === val) {
          candidates.push({ col: k, dist: Math.abs(k - j) });
        }
      }

      if (candidates.length) {
        candidates.sort((a, b) => a.dist - b.dist || a.col - b.col);
        best = {
          startRow: i + 1,
          dateCol: j,
          qtyCol: candidates[0].col,
          maxQty: maxQtyPerRow,
        };
        break;
      }
    }
    if (best) break;
  }

  return best || { startRow: 1, dateCol: 0, qtyCol: 1, maxQty: 500 };
};

export const detectPatientColumns = (rows) => {
  const header = (rows[0] || []).map((value) => String(value || "").toLowerCase());
  let pidCol = -1;
  let nameCol = -1;
  header.forEach((value, index) => {
    if (pidCol < 0 && (value.includes("pid") || value.includes("บัตร") || value.includes("เลขประจำตัว"))) {
      pidCol = index;
    }
    if (nameCol < 0 && (value.includes("ชื่อ") || value.includes("ผู้ป่วย") || value.includes("ชื่อ-สกุล"))) {
      nameCol = index;
    }
  });

  if (pidCol === -1) pidCol = 0;
  if (nameCol === -1) nameCol = pidCol === 0 ? 1 : 0;

  return { startRow: 1, pidCol, nameCol };
};

export const expandSalesRows = (sales) => {
  const out = [];
  for (const sale of sales) {
    const qty = Math.floor(sale.qty);
    if (qty >= 3) {
      const twos = Math.floor(qty / 2);
      for (let i = 0; i < twos; i += 1) {
        out.push({ date: sale.date, qty: 2 });
      }
      if (qty % 2 === 1) {
        out.push({ date: sale.date, qty: 1 });
      }
    } else {
      out.push(sale);
    }
  }
  return out;
};
