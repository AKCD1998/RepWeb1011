export const JUL_SEP_R4_KEY = "ada-pos-20260701-20260930-ky11-r4-draft-v1";

export function summarizeFrozenSales(source) {
  if (!source) return { groups: [], sold: 0, printed: 0, pending: 0 };
  const at = (row, name) => row[source.header.indexOf(name)] ?? "";
  const groups = new Map();
  for (const row of source.rows) {
    const branch = at(row, "branchCode"), code = at(row, "productCode");
    const key = `${branch}:${code}`;
    if (!groups.has(key)) groups.set(key, {
      branch, code, name: at(row, "snapshotProductName") || code,
      sold: 0, printed: 0, pending: 0, status: at(row, "reportStatus"), note: at(row, "reportNote"),
    });
    const group = groups.get(key);
    const sold = Number(at(row, "quantity") || 0);
    const printed = Number(at(row, "printedQuantity") || 0);
    const pending = Number(at(row, "pendingQuantity") || 0);
    if (![sold, printed, pending].every(Number.isSafeInteger) || sold < 0 || printed < 0 || pending < 0 || printed + pending !== sold) {
      throw new Error("ยอดขาย ยอดลงร่าง และยอดค้างในคลังไม่ตรงกัน");
    }
    group.sold += sold; group.printed += printed; group.pending += pending;
  }
  const rows = [...groups.values()].sort((a, b) => a.branch.localeCompare(b.branch) || a.code.localeCompare(b.code));
  return {
    groups: rows,
    sold: rows.reduce((sum, row) => sum + row.sold, 0),
    printed: rows.reduce((sum, row) => sum + row.printed, 0),
    pending: rows.reduce((sum, row) => sum + row.pending, 0),
  };
}

export function frozenArtifactLabel(artifact) {
  if (artifact.key === "combined") return `รวมทุกสาขา · ${artifact.pageCount} หน้า`;
  if (artifact.key === "review") return `รายการค้างและหลักฐาน · ${artifact.pageCount} หน้า`;
  const month = artifact.key.match(/-(2026-0[789])$/)?.[1];
  const monthName = { "2026-07": "กรกฎาคม", "2026-08": "สิงหาคม", "2026-09": "กันยายน" }[month];
  return `สาขา ${artifact.branchCode}${monthName ? ` · ${monthName}` : " · รวม 3 เดือน"} · ${artifact.pageCount} หน้า`;
}
