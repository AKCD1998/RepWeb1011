import { useCallback, useEffect, useMemo, useState } from "react";
import { productLookup, syncSnapshot } from "../utils/deliverCache";
import "./Deliver.css";

const toMoney = (value) => Number(value || 0).toFixed(2);

export default function Deliver() {
  const [items, setItems] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    syncSnapshot().catch(() => {});
  }, []);

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        setIsModalOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [isModalOpen]);

  const handleAddProduct = useCallback((product) => {
    setItems((prev) => {
      const key = String(product?.name ?? "").trim();
      const index = prev.findIndex(
        (item) => String(item?.name ?? "").trim() === key
      );

      if (index >= 0) {
        const next = [...prev];
        next[index] = { ...next[index], qty: next[index].qty + 1 };
        return next;
      }

      return [...prev, { ...product, qty: 1 }];
    });
  }, []);

  const handleBarcodeKeyDown = useCallback(
    async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();

      const inputValue = event.currentTarget.value;
      const product = await productLookup(inputValue);
      if (product) {
        handleAddProduct(product);
      } else {
        console.warn("ไม่พบสินค้า/ออฟไลน์");
      }
      event.currentTarget.value = "";
    },
    [handleAddProduct]
  );

  const handleDelete = useCallback((name) => {
    const key = String(name ?? "").trim();
    setItems((prev) => prev.filter((item) => String(item?.name ?? "").trim() !== key));
  }, []);

  const grandTotal = useMemo(() => {
    return items.reduce((sum, item) => sum + item.qty * item.price, 0);
  }, [items]);

  const handleModalBackdrop = (event) => {
    if (event.target === event.currentTarget) {
      setIsModalOpen(false);
    }
  };

  return (
    <>
      <div
        id="pos-main-page"
        className="rx1011-form-container"
        data-section="pos"
        style={{ marginBottom: "640px" }}
      >
        <section className="pos-section">
          <div className="wrap">
            <div id="posGuard" className="pos-alert hidden">
              ยังกรอกแบบสอบถามไม่ครบ —
              <button id="resumeFormBtn" type="button">
                ไปทำแบบสอบถามต่อ
              </button>
            </div>

            <div className="pos-panel">
              <div className="pos-left">
                <div className="pos-table">
                  <div className="thead">
                    <div>ลำดับที่</div>
                    <div className="thead-barcode">บาร์โค้ด</div>
                    <div className="thead-product-name">รายการสินค้า</div>
                    <div className="hide-md">รหัสสินค้า</div>
                    <div className="hide-sm">ราคาต่อหน่วย</div>
                    <div className="amount">จำนวน</div>
                    <div className="sum">ราคารวม</div>
                    <div className="note-bin">NOTE</div>
                  </div>
                  <div className="tbody" id="items">
                    {items.map((item, index) => (
                      <div key={`${item.name}-${item.barcode}-${index}`} data-name={item.name}>
                        <div className="item-index">{index + 1}</div>
                        <div className="item-barcode">{item.barcode}</div>
                        <div className="item-name">{item.name}</div>
                        <div className="item-company">{item.companyCode}</div>
                        <div className="item-price">{toMoney(item.price)}</div>
                        <div className="item-qty">{item.qty}</div>
                        <div className="item-sum">{toMoney(item.qty * item.price)}</div>
                        <div className="item-note">
                          <button
                            className="item-delete"
                            type="button"
                            onClick={() => handleDelete(item.name)}
                            aria-label="Delete item"
                            data-name={item.name}
                          >
                            <svg
                              className="icon-trash"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM7 9h2v9H7V9Zm-1 12h12a2 2 0 0 0 2-2V8H4v11a2 2 0 0 0 2 2Z"></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pos-inputbar">
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <input
                      id="barcode-input-field"
                      type="text"
                      placeholder="พิมพ์จำนวน → กด 'คูณ (*)' หรือ PageDown → สแกน/พิมพ์บาร์โค้ด แล้วกด Enter"
                      autoComplete="off"
                      onKeyDown={handleBarcodeKeyDown}
                    />
                    <span className="mult" id="multChip"></span>
                  </div>
                  <div className="total">
                    <span id="grand">{toMoney(grandTotal)}</span> บาท
                  </div>
                </div>
              </div>

              <aside className="pos-rail">
                <div className="coupon" id="couponBox">
                  คูณ ( * )<br />
                  <small>PAGE DOWN</small>
                </div>

                <button
                  className="btn btn-primary"
                  id="pos-confirmBtn"
                  type="button"
                  onClick={() => setIsModalOpen(true)}
                  title=""
                >
                  ยืนยันการทำรายการ
                </button>
              </aside>
            </div>
          </div>
        </section>
      </div>

      <div
        id="posMyModal"
        className={`pos-modal${isModalOpen ? "" : " hidden"}`}
        aria-hidden={isModalOpen ? "false" : "true"}
        onClick={handleModalBackdrop}
      >
        <div className="modal-content">
          <span
            className="close"
            data-close
            role="button"
            aria-label="Close"
            onClick={() => setIsModalOpen(false)}
          >
            &times;
          </span>

          <div className="modal-cfHeadBox">
            <div className="modal-head">
              <h2>บันทึกการส่งมอบยา</h2>
              <h5 className="h-description-text">
                โปรดกรอกข้อมูลผู้ซื้อและรายการยาที่จ่ายก่อนส่งมอบยา
              </h5>
            </div>

            <div className="in-modal-separate-compartment-patient">
              <label htmlFor="recipient-name" className="col-form-label">
                ชื่อผู้รับยา:
              </label>
              <input type="text" className="form-control" id="recipient-name" />

              <label htmlFor="recipient-id" className="col-form-label">
                เลขประจำตัวประชาชน:
              </label>
              <input type="text" className="form-control" id="recipient-id" />

              <label htmlFor="recipient-age" className="col-form-label">
                อายุของเจ้าของบัตร
              </label>
              <input type="text" className="form-control" id="recipient-age" />
            </div>

            <div className="in-modal-separate-compartment-medication">
              <label htmlFor="medication-name" className="col-form-label">
                ยาที่ส่งมอบ:
              </label>
              <input type="text" className="form-control" id="medication-name" />

              <label htmlFor="medication-id" className="col-form-label">
                เลขรุ่นที่ผลิต:
              </label>
              <input type="text" className="form-control" id="medication-id" />
            </div>
            <div className="modal-button-group">
              <button className="modal-submit-btn" id="modalSubmitBtn" type="button">
                บันทึกข้อมูล
              </button>
              <button
                className="modal-cancel-btn"
                id="modalCancelBtn"
                type="button"
                data-close
                onClick={() => setIsModalOpen(false)}
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
