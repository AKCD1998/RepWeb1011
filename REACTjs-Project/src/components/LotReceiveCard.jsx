import Card from "./Card";

export default function LotReceiveCard({
  lots,
  setLots,
  lotsLocked,
  setLotsLocked,
}) {
  const updateLot = (index, field, value) => {
    setLots((prev) =>
      prev.map((lot, lotIndex) =>
        lotIndex === index ? { ...lot, [field]: value } : lot
      )
    );
  };

  const addLot = () => {
    setLots((prev) => [...prev, { batch: "", date: "", boxes: "", strips: "" }]);
  };

  return (
    <Card title="ลอตที่รับเข้า">
      <div className="lot-actions">
        <button
          className="ghost-button"
          type="button"
          onClick={addLot}
          disabled={lotsLocked}
        >
          ➕ เพิ่มลอต
        </button>
        <div className="lot-actions-right">
          <button
            className="primary-button"
            type="button"
            onClick={() => setLotsLocked(true)}
            disabled={lotsLocked}
          >
            ยืนยันลอตทั้งหมด
          </button>
          <button
            className="outline-button"
            type="button"
            onClick={() => setLotsLocked(false)}
            disabled={!lotsLocked}
          >
            แก้ไขลอต
          </button>
        </div>
      </div>
      <div className="lot-table">
        <div className="lot-head">
          <span>เลขที่ลอต</span>
          <span>วันรับเข้า</span>
          <span>จำนวนกล่อง</span>
          <span>จำนวนแผง</span>
        </div>
        {lots.map((lot, index) => (
          <div className="lot-row" key={`lot-${index}`}>
            <input
              type="text"
              placeholder="BATCH"
              value={lot.batch}
              onChange={(event) => updateLot(index, "batch", event.target.value)}
              disabled={lotsLocked}
            />
            <input
              type="date"
              value={lot.date}
              onChange={(event) => updateLot(index, "date", event.target.value)}
              disabled={lotsLocked}
            />
            <input
              type="number"
              min="0"
              placeholder="0"
              value={lot.boxes}
              onChange={(event) => updateLot(index, "boxes", event.target.value)}
              disabled={lotsLocked}
            />
            <input
              type="number"
              min="0"
              placeholder="0"
              value={lot.strips}
              onChange={(event) => updateLot(index, "strips", event.target.value)}
              disabled={lotsLocked}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
