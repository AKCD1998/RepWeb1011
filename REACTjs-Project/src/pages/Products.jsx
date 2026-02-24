import { useCallback, useEffect, useMemo, useState } from "react";
import { productsApi } from "../lib/api";
import "./Products.css";

const EMPTY_FORM = {
  productCode: "",
  tradeName: "",
  genericName: "",
  dosageFormCode: "TABLET",
  noteText: "",
};

function normalizeApiError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || "Request failed";
}

export default function Products() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [statusText, setStatusText] = useState("");

  const loadProducts = useCallback(async (searchValue) => {
    setLoading(true);
    setErrorText("");
    try {
      const data = await productsApi.list(searchValue || "");
      setItems(Array.isArray(data) ? data : []);
    } catch (error) {
      setErrorText(normalizeApiError(error));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProducts(query);
  }, [loadProducts, query]);

  const isEditMode = Boolean(editingId);
  const titleText = useMemo(
    () => (isEditMode ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"),
    [isEditMode]
  );

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setQuery(searchInput.trim());
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setErrorText("");
    setStatusText("");

    try {
      const payload = {
        productCode: form.productCode || null,
        tradeName: form.tradeName,
        genericName: form.genericName || null,
        dosageFormCode: form.dosageFormCode || "TABLET",
        noteText: form.noteText || null,
      };

      if (isEditMode) {
        await productsApi.update(editingId, payload);
        setStatusText("อัปเดตรายการสินค้าแล้ว");
      } else {
        await productsApi.create(payload);
        setStatusText("เพิ่มรายการสินค้าแล้ว");
      }

      resetForm();
      await loadProducts(query);
    } catch (error) {
      setErrorText(normalizeApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const handleEditClick = (item) => {
    setEditingId(item.id);
    setForm({
      productCode: item.productCode || "",
      tradeName: item.tradeName || "",
      genericName: item.genericName || "",
      dosageFormCode: item.dosageFormCode || "TABLET",
      noteText: item.noteText || "",
    });
    setStatusText("");
  };

  const handleDeleteClick = async (item) => {
    const ok = window.confirm(`ลบสินค้า "${item.tradeName}" ?`);
    if (!ok) return;
    setErrorText("");
    setStatusText("");
    try {
      await productsApi.remove(item.id);
      setStatusText("ลบสินค้าแล้ว (soft delete)");
      await loadProducts(query);
      if (editingId === item.id) {
        resetForm();
      }
    } catch (error) {
      setErrorText(normalizeApiError(error));
    }
  };

  return (
    <section className="products-page page-placeholder">
      <div className="products-header">
        <h1>จัดการสินค้า</h1>
        <p>CRUD สินค้าผ่าน backend API พร้อมค้นหา/เพิ่ม/แก้ไข/ปิดใช้งาน</p>
      </div>

      <form className="products-search" onSubmit={handleSearchSubmit}>
        <input
          type="text"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="ค้นหาจากชื่อการค้า / ชื่อสามัญ / รหัสสินค้า"
          aria-label="ค้นหาสินค้า"
        />
        <button type="submit" className="products-btn">
          ค้นหา
        </button>
      </form>

      <form className="products-form" onSubmit={handleSubmit}>
        <div className="products-form-title">{titleText}</div>
        <div className="products-grid">
          <label>
            รหัสสินค้า
            <input
              type="text"
              value={form.productCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, productCode: event.target.value }))
              }
            />
          </label>
          <label>
            ชื่อการค้า*
            <input
              type="text"
              required
              value={form.tradeName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, tradeName: event.target.value }))
              }
            />
          </label>
          <label>
            ชื่อสามัญ
            <input
              type="text"
              value={form.genericName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, genericName: event.target.value }))
              }
            />
          </label>
          <label>
            Dosage Form Code
            <input
              type="text"
              value={form.dosageFormCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, dosageFormCode: event.target.value }))
              }
            />
          </label>
          <label className="products-note">
            หมายเหตุ
            <textarea
              rows={2}
              value={form.noteText}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, noteText: event.target.value }))
              }
            />
          </label>
        </div>
        <div className="products-actions">
          <button type="submit" className="products-btn" disabled={saving}>
            {saving ? "กำลังบันทึก..." : isEditMode ? "อัปเดตสินค้า" : "เพิ่มสินค้า"}
          </button>
          <button
            type="button"
            className="products-btn secondary"
            onClick={resetForm}
            disabled={saving}
          >
            ล้างฟอร์ม
          </button>
        </div>
      </form>

      {errorText ? <div className="products-alert error">{errorText}</div> : null}
      {statusText ? <div className="products-alert success">{statusText}</div> : null}

      <div className="products-table-wrap">
        <table className="products-table">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อการค้า</th>
              <th>ชื่อสามัญ</th>
              <th>รูปแบบยา</th>
              <th>สถานะ</th>
              <th>การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6}>กำลังโหลด...</td>
              </tr>
            ) : items.length ? (
              items.map((item) => (
                <tr key={item.id}>
                  <td>{item.productCode || "-"}</td>
                  <td>{item.tradeName}</td>
                  <td>{item.genericName || "-"}</td>
                  <td>{item.dosageFormCode || "-"}</td>
                  <td>{item.isActive ? "ใช้งาน" : "ปิดใช้งาน"}</td>
                  <td>
                    <div className="products-row-actions">
                      <button
                        type="button"
                        className="products-btn small"
                        onClick={() => handleEditClick(item)}
                      >
                        แก้ไข
                      </button>
                      <button
                        type="button"
                        className="products-btn small danger"
                        onClick={() => handleDeleteClick(item)}
                      >
                        ลบ
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>ไม่พบข้อมูล</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
