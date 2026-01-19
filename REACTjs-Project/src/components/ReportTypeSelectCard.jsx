import Card from "./Card";
import FieldRow from "./FieldRow";

export default function ReportTypeSelectCard({
  branch,
  setBranch,
  reportType,
  setReportType,
  productName,
  setProductName,
  productOptions,
  sourceName,
  setSourceName,
  sku,
  setSku,
  maker,
}) {
  return (
    <Card title="ข้อมูลรายงาน">
      <div className="form-grid">
        <FieldRow label="สาขา" htmlFor="branch">
          <select
            id="branch"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          >
            <option value="">เลือกสาขา</option>
            <option value="001">001</option>
            <option value="003">003</option>
            <option value="004">004</option>
          </select>
        </FieldRow>
        <FieldRow label="ประเภทรายงาน" htmlFor="reportType">
          <select
            id="reportType"
            value={reportType}
            onChange={(event) => setReportType(event.target.value)}
          >
            <option value="">เลือกรูปแบบรายงาน</option>
            <option value="r11_dxm">r11_dxm</option>
            <option value="r11_antihist1_liquid">r11_antihist1_liquid</option>
            <option value="r10_special_control">r10_special_control</option>
          </select>
        </FieldRow>
        <FieldRow label="สินค้าที่ทำรายงาน" htmlFor="productName">
          <select
            id="productName"
            value={productName}
            onChange={(event) => setProductName(event.target.value)}
          >
            <option value="">เลือกสินค้า</option>
            {productOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </FieldRow>
      </div>
      <div className="field-row">
        <label htmlFor="sku">SKU</label>
        <div className="input-with-icon">
          <input
            id="sku"
            type="text"
            value={sku}
            onChange={(event) => setSku(event.target.value)}
          />
          <button className="icon-button" type="button" aria-label="ตั้งค่า SKU">
            ⚙
          </button>
        </div>
      </div>
      <FieldRow label="ได้มาจาก" htmlFor="sourceName">
        <input
          id="sourceName"
          type="text"
          placeholder="ระบุแหล่งที่มา"
          value={sourceName}
          onChange={(event) => setSourceName(event.target.value)}
        />
      </FieldRow>
      <FieldRow label="ชื่อผู้ผลิต/ผู้นำเข้า" htmlFor="makerName">
        <input
          id="makerName"
          type="text"
          readOnly
          value={maker}
          placeholder="อ่านอย่างเดียว"
        />
      </FieldRow>
      <div className="upload-block no-print">
        <div className="upload-row">
          <label htmlFor="salesCsv">อัปโหลด CSV ยอดขาย</label>
          <input id="salesCsv" type="file" />
        </div>
        <div className="upload-row">
          <label htmlFor="patientCsv">อัปโหลด CSV รายชื่อผู้ป่วย</label>
          <input id="patientCsv" type="file" />
        </div>
      </div>
    </Card>
  );
}
