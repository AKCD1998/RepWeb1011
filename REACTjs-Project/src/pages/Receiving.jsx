import "./Receiving.css";

export default function Receiving() {
  return (
    <div className="outerpad receiving-page">
      <div id="product-admin" className="qgrid receiving-top">
        <button
          id="btnReceiveActions"
          className="actionTile"
          type="button"
          aria-label="ลงข้อมูลรับเข้า ส่งออกสินค้า"
        >
          {/* TODO: Replace logoMark with <img src=\"...\" alt=\"SC logo\" /> once asset is available. */}
          <div className="logoMark" aria-hidden="true">
            SC
          </div>
          <div className="actionTile-label">ลงข้อมูลรับเข้า ส่งออกสินค้า</div>
        </button>

        <section id="search-panel" className="qcard search-panel">
          <div className="section-header">
            <strong>สืบค้นรายการสินค้า</strong>
          </div>
            <div className="search-row">
              <label htmlFor="prodSearch">ข้อมูลค้นหา</label>
              <input
                id="prodSearch"
                type="text"
                className="qinput"
                placeholder="ชื่อสามัญ / บริษัท / บาร์โค้ด"
              />
              <button type="button" className="btn btn--accent" id="btnSearch">
                🔎 ค้นหา
              </button>
            </div>
        </section>

        <button
          id="btnAddNew"
            className="addTile"
            title="เพิ่มสินค้าใหม่"
            aria-label="เพิ่มสินค้าใหม่"
            type="button"
          >
            <svg width="110" height="110" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" />
            </svg>
            <div className="addTile-label">เพิ่มสินค้าใหม่</div>
          </button>
      </div>

      <div className="qgrid config-grid">
        <div className="qcard config-bar">
          <button id="btnTableConfig" className="btn btn--yellow" type="button">
            ตั้งค่าแสดงผลตาราง
          </button>

          <label className="page-size-label" htmlFor="pageSize">
            <span>แสดง</span>
            <select id="pageSize" className="qinput" defaultValue="50">
              <option value="10">10 รายการ</option>
              <option value="50">50 รายการ</option>
              <option value="100">100 รายการ</option>
              <option value="all">แสดงทั้งหมด</option>
            </select>
            <span>ต่อหน้า</span>
          </label>

          <div id="tableTotals" className="table-totals">
            รวม 0 รายการ
          </div>
        </div>
      </div>

      <div className="qcard results-card">
        <div className="pos-table">
          <div className="thead" id="tableHead"></div>
          <div className="tbody" id="tableBody"></div>
        </div>
      </div>

      <div id="tablePager" className="qcard table-pager"></div>

      <div id="tableConfigModal" className="modal hidden" aria-hidden="true">
        <div className="qcard modal-card">
          <div className="section-header">
            <strong>ตั้งค่าแสดงผลตาราง</strong>
          </div>
          <ul id="colList" className="col-list"></ul>
          <div className="modal-actions">
            <button className="btn" id="btnCfgCancel" type="button">
              ยกเลิก
            </button>
            <button className="btn btn--yellow" id="btnCfgSave" type="button">
              บันทึก
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
