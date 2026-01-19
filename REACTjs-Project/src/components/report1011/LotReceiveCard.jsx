import Card from "./Card";
import { fmtThai } from "../../lib/report1011/utils";

export default function LotReceiveCard({
  lotDraft,
  onLotDraftChange,
  lots,
  onAddLot,
  onDeleteLot,
  lotsFinalized,
  onFinalizeLots,
  onEditLots,
  lotSummary,
}) {
  return (
    <Card title="ลอตที่รับเข้า">
      <div className="lot-actions">
        <button
          className="ghost-button"
          type="button"
          onClick={onAddLot}
          disabled={lotsFinalized}
        >
          ➕ เพิ่มลอต
        </button>
        <div className="lot-actions-right">
          <button
            className="primary-button"
            type="button"
            onClick={onFinalizeLots}
            disabled={lotsFinalized}
          >
            ยืนยันลอตทั้งหมด
          </button>
          <button
            className="outline-button"
            type="button"
            onClick={onEditLots}
            disabled={!lotsFinalized}
          >
            แก้ไขลอต
          </button>
        </div>
      </div>

      <div className="lot-form">
        <input
          type="text"
          placeholder="เลขที่ลอต"
          value={lotDraft.batch}
          onChange={(event) => onLotDraftChange("batch", event.target.value)}
          disabled={lotsFinalized}
        />
        <input
          type="date"
          value={lotDraft.date}
          onChange={(event) => onLotDraftChange("date", event.target.value)}
          disabled={lotsFinalized}
        />
        <input
          type="number"
          min="1"
          placeholder="จำนวนกล่อง"
          value={lotDraft.boxes}
          onChange={(event) => onLotDraftChange("boxes", event.target.value)}
          disabled={lotsFinalized}
        />
        <input
          type="number"
          min="1"
          placeholder="จำนวนแผง"
          value={lotDraft.strips}
          onChange={(event) => onLotDraftChange("strips", event.target.value)}
          disabled={lotsFinalized}
        />
      </div>

      <div className="lot-table">
        <div className="lot-head">
          <span>เลขที่ลอต</span>
          <span>วันรับเข้า</span>
          <span>จำนวนกล่อง</span>
          <span>จำนวนแผง</span>
          <span className="no-print">ลบ</span>
        </div>
        {lots.length ? (
          lots.map((lot, index) => (
            <div className="lot-row" key={`lot-${index}`}>
              <span>{lot.batch || "-"}</span>
              <span>{lot.date ? fmtThai(lot.date) : "-"}</span>
              <span>{lot.boxes}</span>
              <span>{lot.strips}</span>
              <button
                type="button"
                className="ghost-button no-print"
                onClick={() => onDeleteLot(index)}
                disabled={lotsFinalized}
              >
                ลบ
              </button>
            </div>
          ))
        ) : (
          <p className="muted">ยังไม่มีลอต</p>
        )}
      </div>

      <p className="lot-summary">{lotSummary}</p>
    </Card>
  );
}
