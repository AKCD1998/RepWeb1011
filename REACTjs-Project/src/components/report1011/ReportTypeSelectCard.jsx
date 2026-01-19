import Card from "./Card";
import FieldRow from "./FieldRow";

export default function ReportTypeSelectCard({
  branches,
  branchId,
  onBranchChange,
  reportType,
  onReportTypeChange,
  reportTypeOptions,
  productName,
  onProductChange,
  productOptions,
  sku,
  isSkuEditing,
  onSkuChange,
  onSkuEdit,
  onSkuSave,
  onSkuCancel,
  maker,
  onSalesFileChange,
  patientsStatus,
}) {
  return (
    <Card title="ข้อมูลรายงาน">
      <div className="form-grid">
        <FieldRow label="สาขา" htmlFor="branch">
          <select
            id="branch"
            value={branchId}
            onChange={(event) => onBranchChange(event.target.value)}
          >
            <option value="">เลือกสาขา…</option>
            {branches.map((branch) => (
              <option key={branch.value} value={branch.value}>
                {branch.label}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="ประเภทรายงาน ขย." htmlFor="reportType">
          <select
            id="reportType"
            value={reportType}
            onChange={(event) => onReportTypeChange(event.target.value)}
          >
            <option value="">เลือกรูปแบบรายงาน</option>
            {reportTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="สินค้าที่ทำรายงาน" htmlFor="productName">
          <select
            id="productName"
            value={productName}
            onChange={(event) => onProductChange(event.target.value)}
            disabled={!productOptions.length}
          >
            <option value="" disabled>
              {productOptions.length ? "เลือกสินค้า" : "— ไม่มีรายการ —"}
            </option>
            {productOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </FieldRow>
      </div>

      <div className="field-row">
        <label htmlFor="sku">ได้มาจาก</label>
        <div className="sku-row">
          {isSkuEditing ? (
            <input
              id="sku"
              type="text"
              value={sku}
              onChange={(event) => onSkuChange(event.target.value)}
            />
          ) : (
            <input id="sku" type="text" value={sku} readOnly />
          )}
          <div className="sku-actions">
            {isSkuEditing ? (
              <>
                <button className="outline-button" type="button" onClick={onSkuSave}>
                  บันทึก
                </button>
                <button className="ghost-button" type="button" onClick={onSkuCancel}>
                  ยกเลิก
                </button>
              </>
            ) : (
              <button
                className="icon-button"
                type="button"
                aria-label="ตั้งค่า SKU"
                onClick={onSkuEdit}
              >
                ⚙
              </button>
            )}
          </div>
        </div>
      </div>

      <FieldRow label="ชื่อผู้ผลิต/ผู้นำเข้า" htmlFor="makerName">
        <input id="makerName" type="text" readOnly value={maker} />
      </FieldRow>

      <div className="upload-block no-print">
        <div className="upload-row">
          <label htmlFor="salesCsv">อัปโหลด CSV ยอดขาย</label>
          <input
            id="salesCsv"
            type="file"
            onChange={(event) => onSalesFileChange(event.target.files?.[0] || null)}
          />
        </div>
        <div className="upload-row">
          <label>รายชื่อผู้ป่วย (ระบบ)</label>
          <div className="patients-status">{patientsStatus}</div>
        </div>
      </div>
    </Card>
  );
}
