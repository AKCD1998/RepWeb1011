import { useMemo, useState } from "react";
import { frozenArtifactLabel, summarizeFrozenSales } from "../../lib/report1011/bulkArchive.js";

export default function FrozenQuarterArchive({ source, version, versions, savedArtifacts, onVersion, onDownload, onSourceDownload, message }) {
  const [branch, setBranch] = useState("");
  const summary = useMemo(() => {
    try { return { ...summarizeFrozenSales(source), error: "" }; }
    catch (error) { return { groups: [], sold: 0, printed: 0, pending: 0, error: error.message }; }
  }, [source]);
  const groups = branch ? summary.groups.filter((row) => row.branch === branch) : summary.groups;
  const artifacts = savedArtifacts.items.filter((file) => !branch || !file.branchCode || file.branchCode === branch);
  const number = (value) => Number(value || 0).toLocaleString("th-TH");
  return <div className="manual-bulk"><fieldset className="manual-bulk-controls no-print">
    <legend>คลังร่าง ข.ย.11 · กรกฎาคม–กันยายน 2569</legend>
    <label>เวอร์ชันข้อมูลต้นทาง <select value={version.key} onChange={(event) => onVersion(event.target.value)}>
      {versions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
    </select></label>
    <p>สาขา 001, 003, 004 และ 005 · ยอดขายตาม Ada POS · หลักฐานรับและโอนรุ่น R4</p>
    <p>ยอดขาย {number(summary.sold)} หน่วย · ลงร่าง {number(summary.printed)} หน่วย · ค้าง {number(summary.pending)} หน่วย</p>
    <p className="muted">เก็บ PDF และผลจัดสรรผู้ซื้อของรุ่นนี้ไว้แล้ว ดาวน์โหลดซ้ำได้ไฟล์เดิม ล็อตที่อนุมานและยอดยกมายังต้องให้เภสัชกรตรวจ เอกสารเว้นช่องลงนามไว้</p>
    {summary.error ? <p role="alert">{summary.error}</p> : null}
    <label>แสดงสาขา <select value={branch} onChange={(event) => setBranch(event.target.value)}>
      <option value="">ทุกสาขา</option>{["001", "003", "004", "005"].map((code) => <option key={code} value={code}>สาขา {code}</option>)}
    </select></label>
    {savedArtifacts.status === "loading" ? <p role="status">กำลังโหลดรายการ PDF…</p> : null}
    {savedArtifacts.error ? <p role="alert">{savedArtifacts.error}</p> : null}
    <div className="manual-bulk-actions">
      {artifacts.map((file) => <button className="primary-button" type="button" key={file.key} onClick={() => onDownload(file)}>{frozenArtifactLabel(file)}</button>)}
      <button className="outline-button" type="button" onClick={onSourceDownload}>ดาวน์โหลดข้อมูลต้นทางและผลจัดสรร CSV</button>
    </div>
    {message ? <p role="status">{message}</p> : null}
    <div className="manual-bulk-frozen-table-wrap"><table>
      <thead><tr><th>สาขา</th><th>สินค้า</th><th>ยอดขาย</th><th>ลงร่าง</th><th>ค้าง</th><th>หมายเหตุการตรวจ</th></tr></thead>
      <tbody>{groups.map((row) => <tr key={`${row.branch}:${row.code}`}><td>{row.branch}</td><td>{row.code} · {row.name}</td><td>{number(row.sold)}</td><td>{number(row.printed)}</td><td>{number(row.pending)}</td><td>{row.note || "ร่างรอเภสัชกรตรวจ"}</td></tr>)}</tbody>
    </table></div>
  </fieldset></div>;
}
