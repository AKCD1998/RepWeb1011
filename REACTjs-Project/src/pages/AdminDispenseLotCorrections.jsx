import { useMemo, useState } from "react";
import { adminApi } from "../lib/api";
import "./AdminDispenseLotCorrections.css";

function toCleanText(value) {
  return String(value ?? "").trim();
}

function formatDateTime(value) {
  const text = toCleanText(value);
  if (!text) return "-";

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return date.toLocaleString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBaseQuantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function buildLotOptionLabel(lot) {
  const lotNo = toCleanText(lot?.lotNo) || "(ไม่มี lot no)";
  const expDate = toCleanText(lot?.expDate) || "-";
  const quantityOnHandBase = formatBaseQuantity(lot?.quantityOnHandBase);
  return `${lotNo} • exp ${expDate} • stock ${quantityOnHandBase} base`;
}

export default function AdminDispenseLotCorrections() {
  const [lineIdInput, setLineIdInput] = useState("");
  const [detail, setDetail] = useState(null);
  const [selectedLotId, setSelectedLotId] = useState("");
  const [reason, setReason] = useState("");
  const [pageError, setPageError] = useState("");
  const [pageMessage, setPageMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dispenseLine = detail?.dispenseLine || null;
  const availableLots = Array.isArray(detail?.availableLots) ? detail.availableLots : [];
  const selectedLot = availableLots.find((lot) => toCleanText(lot.id) === toCleanText(selectedLotId)) || null;
  const currentLotId = toCleanText(dispenseLine?.lotId);

  const hasDifferentSelectedLot =
    toCleanText(selectedLotId) && toCleanText(selectedLotId) !== currentLotId;

  const warningText = useMemo(() => {
    if (!detail?.correctionWarning) return "";
    return detail.correctionWarning;
  }, [detail?.correctionWarning]);

  async function handleLoad(event) {
    event.preventDefault();
    const lineId = toCleanText(lineIdInput);
    if (!lineId) {
      setPageError("กรุณากรอก dispense line id");
      return;
    }

    setIsLoading(true);
    setPageError("");
    setPageMessage("");
    try {
      const payload = await adminApi.getDispenseLine(lineId);
      setDetail(payload);
      setReason("");
      const firstAlternative = (Array.isArray(payload?.availableLots) ? payload.availableLots : []).find(
        (lot) => toCleanText(lot?.id) && toCleanText(lot?.id) !== toCleanText(payload?.dispenseLine?.lotId)
      );
      setSelectedLotId(firstAlternative?.id || "");
    } catch (error) {
      setDetail(null);
      setSelectedLotId("");
      setPageError(error?.message || "โหลดข้อมูล dispense line ไม่สำเร็จ");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!dispenseLine?.id) {
      setPageError("ยังไม่ได้โหลด dispense line");
      return;
    }
    if (!hasDifferentSelectedLot) {
      setPageError("กรุณาเลือก lot ใหม่ที่ต่างจาก lot เดิม");
      return;
    }
    if (!toCleanText(reason)) {
      setPageError("กรุณาระบุเหตุผลก่อนบันทึก corrective action");
      return;
    }

    const confirmed = window.confirm(
      "ยืนยัน corrective action นี้?\nระบบจะคืน stock ให้ lot เดิม, หัก stock จาก lot ใหม่, อัปเดต dispense line และ stock movement พร้อมบันทึก audit"
    );
    if (!confirmed) return;

    setIsSubmitting(true);
    setPageError("");
    setPageMessage("");
    try {
      const response = await adminApi.correctDispenseLineLot(dispenseLine.id, {
        newLotId: selectedLotId,
        reason,
      });
      setDetail(response?.current || null);
      setPageMessage(
        `บันทึก corrective action สำเร็จ${toCleanText(response?.auditId) ? ` (audit ${response.auditId})` : ""}`
      );
      setReason("");
      const refreshedLots = Array.isArray(response?.current?.availableLots) ? response.current.availableLots : [];
      const nextCurrentLotId = toCleanText(response?.current?.dispenseLine?.lotId);
      const nextAlternative = refreshedLots.find((lot) => toCleanText(lot?.id) !== nextCurrentLotId);
      setSelectedLotId(nextAlternative?.id || "");
    } catch (error) {
      setPageError(error?.message || "บันทึก corrective action ไม่สำเร็จ");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="outerpad admin-dispense-lot-page">
      <div className="qgrid admin-dispense-lot-page__top">
        <section className="qcard admin-dispense-lot-page__hero">
          <div className="section-header">
            <strong>แก้ lot ของรายการจ่ายยาเดิม</strong>
          </div>
          <p>
            ใช้เมื่อ admin ต้องแก้ lot ของ dispense line หนึ่งรายการย้อนหลังเท่านั้น
            ระบบจะ rebalance stock ระหว่าง lot เดิมและ lot ใหม่ พร้อมเก็บ audit ทุกครั้ง
          </p>
          <div className="admin-dispense-lot-page__warning">
            คำเตือน: นี่คือ corrective action สำหรับ transaction ในอดีต ต้องระบุเหตุผลทุกครั้ง และห้ามใช้แทนการ merge/rename lot ทั้งระบบ
          </div>
        </section>

        <section className="qcard admin-dispense-lot-page__lookup">
          <div className="section-header">
            <strong>โหลด dispense line</strong>
          </div>
          <form className="admin-dispense-lot-page__lookup-form" onSubmit={handleLoad}>
            <label htmlFor="dispense-line-id">Dispense line id</label>
            <input
              id="dispense-line-id"
              type="text"
              className="qinput"
              value={lineIdInput}
              onChange={(event) => setLineIdInput(event.target.value)}
              placeholder="วาง dispense_lines.id ที่ต้องการแก้ lot"
            />
            <button type="submit" className="btn btn--accent" disabled={isLoading}>
              {isLoading ? "กำลังโหลด..." : "โหลดข้อมูล"}
            </button>
          </form>
        </section>
      </div>

      {pageError ? <div className="admin-dispense-lot-page__feedback admin-dispense-lot-page__feedback--error">{pageError}</div> : null}
      {pageMessage ? <div className="admin-dispense-lot-page__feedback admin-dispense-lot-page__feedback--success">{pageMessage}</div> : null}

      {dispenseLine ? (
        <div className="qgrid admin-dispense-lot-page__layout">
          <section className="qcard admin-dispense-lot-page__detail">
            <div className="section-header">
              <strong>รายละเอียดรายการ</strong>
            </div>
            <div className="admin-dispense-lot-page__detail-grid">
              <div>
                <span>Dispense line</span>
                <strong>{dispenseLine.id}</strong>
              </div>
              <div>
                <span>Dispense header</span>
                <strong>{toCleanText(dispenseLine.headerId) || "-"}</strong>
              </div>
              <div>
                <span>สินค้า</span>
                <strong>{`${toCleanText(dispenseLine.productCode) || "-"} • ${toCleanText(dispenseLine.tradeName) || "-"}`}</strong>
              </div>
              <div>
                <span>สาขา</span>
                <strong>{`${toCleanText(dispenseLine.branchCode) || "-"} • ${toCleanText(dispenseLine.branchName) || "-"}`}</strong>
              </div>
              <div>
                <span>ผู้ป่วย</span>
                <strong>{`${toCleanText(dispenseLine.patientPid) || "-"} • ${toCleanText(dispenseLine.patientFullName) || "-"}`}</strong>
              </div>
              <div>
                <span>วันเวลาจ่าย</span>
                <strong>{formatDateTime(dispenseLine.dispensedAt)}</strong>
              </div>
              <div>
                <span>จำนวน</span>
                <strong>{`${formatBaseQuantity(dispenseLine.quantity)} ${toCleanText(dispenseLine.unitLabel) || "unit"}`}</strong>
              </div>
              <div>
                <span>จำนวนฐาน</span>
                <strong>{dispenseLine.quantityBase === null ? "-" : `${formatBaseQuantity(dispenseLine.quantityBase)} base`}</strong>
              </div>
              <div>
                <span>lot เดิม</span>
                <strong>{`${toCleanText(dispenseLine.lotNo) || "-"} • ${toCleanText(dispenseLine.lotExpDate) || "-"}`}</strong>
              </div>
            </div>

            {warningText ? (
              <div className="admin-dispense-lot-page__state admin-dispense-lot-page__state--warning">
                {warningText}
              </div>
            ) : null}
          </section>

          <section className="qcard admin-dispense-lot-page__action">
            <div className="section-header">
              <strong>บันทึก corrective action</strong>
            </div>
            <form className="admin-dispense-lot-page__action-form" onSubmit={handleSubmit}>
              <label htmlFor="new-lot-id">เลือก lot ใหม่</label>
              <select
                id="new-lot-id"
                className="qinput"
                value={selectedLotId}
                onChange={(event) => setSelectedLotId(event.target.value)}
                disabled={!detail?.canCorrect || isSubmitting}
              >
                <option value="">-- เลือก lot เป้าหมาย --</option>
                {availableLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {buildLotOptionLabel(lot)}
                    {toCleanText(lot.id) === currentLotId ? " (lot ปัจจุบัน)" : ""}
                  </option>
                ))}
              </select>

              {selectedLot ? (
                <div className="admin-dispense-lot-page__lot-preview">
                  <strong>lot ใหม่ที่เลือก</strong>
                  <span>{buildLotOptionLabel(selectedLot)}</span>
                </div>
              ) : null}

              <label htmlFor="lot-correction-reason">เหตุผล</label>
              <textarea
                id="lot-correction-reason"
                className="qinput"
                rows={5}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="อธิบายว่าเหตุใด lot เดิมจึงผิด และเหตุใด lot ใหม่นี้จึงเป็น lot ที่จ่ายจริง"
                disabled={!detail?.canCorrect || isSubmitting}
              />

              <div className="admin-dispense-lot-page__reminder">
                ระบบจะคืน stock ให้ lot เดิม แล้วหัก stock จาก lot ใหม่เฉพาะ dispense line นี้เท่านั้น
              </div>

              <button
                type="submit"
                className="btn btn--accent"
                disabled={!detail?.canCorrect || !hasDifferentSelectedLot || isSubmitting}
              >
                {isSubmitting ? "กำลังบันทึก..." : "ยืนยัน corrective action"}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
