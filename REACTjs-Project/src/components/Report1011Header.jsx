import Card from "./Card";

export default function Report1011Header() {
  return (
    <header className="report1011-header no-print">
      <div>
        <p className="eyebrow">ระบบรายงานมาตรฐาน</p>
        <h1>สร้างรายงาน ขย. 10/11</h1>
        <p className="subtitle">
          จัดการรายละเอียดสินค้าและลอตรับเข้า พร้อมสร้างรายงานอย่างเป็นทางการ
        </p>
      </div>
      <Card className="header-card">
        <div className="header-card-row">
          <div>
            <p className="muted">สถานะล่าสุด</p>
            <p className="strong">ยังไม่สร้างรายงาน</p>
          </div>
          <span className="status-pill">Draft</span>
        </div>
        <div className="header-meta">
          <div>
            <p className="muted">เอกสารอ้างอิง</p>
            <p className="strong">RX1011</p>
          </div>
          <div>
            <p className="muted">ผู้รับผิดชอบ</p>
            <p className="strong">—</p>
          </div>
        </div>
      </Card>
    </header>
  );
}
