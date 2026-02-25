import { useCallback, useEffect, useMemo, useState } from "react";
import { productsApi } from "../lib/api";
import "./Products.css";

const EMPTY_INGREDIENT = {
  activeIngredientCode: "",
  nameEn: "",
  nameTh: "",
  strengthNumerator: "",
  numeratorUnitCode: "",
  strengthDenominator: "",
  denominatorUnitCode: "",
};

function createEmptyIngredient() {
  return { ...EMPTY_INGREDIENT };
}

function createEmptyForm() {
  return {
    productCode: "",
    barcode: "",
    tradeName: "",
    genericName: "",
    dosageFormCode: "TABLET",
    manufacturerName: "",
    packageSize: "",
    unitTypeCode: "",
    price: "",
    reportGroupCode: "",
    noteText: "",
    ingredients: [createEmptyIngredient()],
  };
}

function isIngredientRowBlank(ingredient) {
  return (
    !String(ingredient?.activeIngredientCode || "").trim() &&
    !String(ingredient?.nameEn || "").trim() &&
    !String(ingredient?.nameTh || "").trim() &&
    !String(ingredient?.strengthNumerator || "").trim() &&
    !String(ingredient?.numeratorUnitCode || "").trim() &&
    !String(ingredient?.strengthDenominator || "").trim() &&
    !String(ingredient?.denominatorUnitCode || "").trim()
  );
}

function normalizeIngredientForForm(ingredient) {
  return {
    activeIngredientCode: ingredient?.activeIngredientCode || "",
    nameEn: ingredient?.nameEn || "",
    nameTh: ingredient?.nameTh || "",
    strengthNumerator:
      ingredient?.strengthNumerator === null || ingredient?.strengthNumerator === undefined
        ? ""
        : String(ingredient.strengthNumerator),
    numeratorUnitCode: ingredient?.numeratorUnitCode || "",
    strengthDenominator:
      ingredient?.strengthDenominator === null || ingredient?.strengthDenominator === undefined
        ? ""
        : String(ingredient.strengthDenominator),
    denominatorUnitCode: ingredient?.denominatorUnitCode || "",
  };
}

function normalizeApiError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || "Request failed";
}

export default function Products() {
  const [items, setItems] = useState([]);
  const [reportGroups, setReportGroups] = useState([]);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [form, setForm] = useState(createEmptyForm);
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

  useEffect(() => {
    let cancelled = false;
    productsApi
      .reportGroups()
      .then((rows) => {
        if (cancelled) return;
        setReportGroups(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (cancelled) return;
        setReportGroups([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isEditMode = Boolean(editingId);
  const titleText = useMemo(
    () => (isEditMode ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"),
    [isEditMode]
  );
  const reportGroupOptions = useMemo(() => {
    if (reportGroups.length) return reportGroups;
    return [
      { code: "KY10", thaiName: "บัญชีการขายยาควบคุมพิเศษ (ข.ย.10)" },
      { code: "KY11", thaiName: "บัญชีการขายยาอันตราย (ข.ย.11)" },
    ];
  }, [reportGroups]);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setQuery(searchInput.trim());
  };

  const resetForm = () => {
    setForm(createEmptyForm());
    setEditingId("");
  };

  const updateIngredientField = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) =>
        currentIndex === index ? { ...ingredient, [field]: value } : ingredient
      ),
    }));
  };

  const addIngredientRow = () => {
    setForm((prev) => ({
      ...prev,
      ingredients: [...prev.ingredients, createEmptyIngredient()],
    }));
  };

  const removeIngredientRow = (index) => {
    setForm((prev) => {
      if (prev.ingredients.length <= 1) {
        return {
          ...prev,
          ingredients: [createEmptyIngredient()],
        };
      }

      return {
        ...prev,
        ingredients: prev.ingredients.filter((_, currentIndex) => currentIndex !== index),
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setErrorText("");
    setStatusText("");

    try {
      const ingredientsPayload = form.ingredients
        .map((ingredient) => ({
          activeIngredientCode: ingredient.activeIngredientCode.trim() || null,
          nameEn: ingredient.nameEn.trim() || null,
          nameTh: ingredient.nameTh.trim() || null,
          strengthNumerator: ingredient.strengthNumerator,
          numeratorUnitCode: ingredient.numeratorUnitCode.trim() || null,
          strengthDenominator: ingredient.strengthDenominator,
          denominatorUnitCode: ingredient.denominatorUnitCode.trim() || null,
        }))
        .filter((ingredient) => !isIngredientRowBlank(ingredient));

      const payload = {
        productCode: form.productCode || null,
        barcode: form.barcode || null,
        tradeName: form.tradeName,
        genericName: form.genericName || null,
        dosageFormCode: form.dosageFormCode || "TABLET",
        manufacturerName: form.manufacturerName || null,
        packageSize: form.packageSize || null,
        unitTypeCode: form.unitTypeCode || null,
        price: form.price === "" ? null : form.price,
        reportGroupCodes: form.reportGroupCode ? [form.reportGroupCode] : [],
        noteText: form.noteText || null,
        ingredients: ingredientsPayload,
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
    const ingredientRows =
      Array.isArray(item.ingredients) && item.ingredients.length
        ? item.ingredients.map(normalizeIngredientForForm)
        : [createEmptyIngredient()];

    setEditingId(item.id);
    setForm({
      productCode: item.productCode || "",
      barcode: item.barcode || "",
      tradeName: item.tradeName || "",
      genericName: item.genericName || "",
      dosageFormCode: item.dosageFormCode || "TABLET",
      manufacturerName: item.manufacturerName || "",
      packageSize: item.packageSize || "",
      unitTypeCode: item.unitTypeCode || "",
      price: item.price === null || item.price === undefined ? "" : String(item.price),
      reportGroupCode: Array.isArray(item.reportGroupCodes) ? item.reportGroupCodes[0] || "" : "",
      noteText: item.noteText || "",
      ingredients: ingredientRows,
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
            บาร์โค้ด
            <input
              type="text"
              value={form.barcode}
              onChange={(event) => setForm((prev) => ({ ...prev, barcode: event.target.value }))}
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
            ผู้ผลิต/ผู้นำเข้า
            <input
              type="text"
              value={form.manufacturerName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, manufacturerName: event.target.value }))
              }
            />
          </label>
          <label>
            ชื่อสามัญ (สรุป)
            <input
              type="text"
              value={form.genericName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, genericName: event.target.value }))
              }
            />
          </label>
          <label>
            ขนาดบรรจุภัณฑ์
            <input
              type="text"
              placeholder="เช่น 1 กล่อง = 10 แผง"
              value={form.packageSize}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, packageSize: event.target.value }))
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
          <label>
            Unit Type Code
            <input
              type="text"
              placeholder="เช่น BLISTER / BOTTLE"
              value={form.unitTypeCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, unitTypeCode: event.target.value }))
              }
            />
          </label>
          <label>
            ราคาขายต่อหน่วย
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
            />
          </label>
          <label>
            ชนิดรายงาน (ข.ย.)
            <select
              value={form.reportGroupCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, reportGroupCode: event.target.value }))
              }
            >
              <option value="">ไม่ระบุ</option>
              {reportGroupOptions.map((group) => (
                <option key={group.code} value={group.code}>
                  {group.code}
                  {group.thaiName ? ` - ${group.thaiName}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="products-ingredients">
            <div className="products-ingredients-header">
              <strong>ตัวยาสำคัญ (สูตรผสม)</strong>
              <button type="button" className="products-btn small secondary" onClick={addIngredientRow}>
                เพิ่มตัวยา
              </button>
            </div>
            {form.ingredients.map((ingredient, index) => (
              <div className="products-ingredient-row" key={`ingredient-${index}`}>
                <input
                  type="text"
                  placeholder="ชื่อสารสำคัญ (EN) *"
                  value={ingredient.nameEn}
                  onChange={(event) => updateIngredientField(index, "nameEn", event.target.value)}
                />
                <input
                  type="text"
                  placeholder="ความแรง"
                  value={ingredient.strengthNumerator}
                  onChange={(event) =>
                    updateIngredientField(index, "strengthNumerator", event.target.value)
                  }
                />
                <input
                  type="text"
                  placeholder="หน่วยตัวตั้ง (เช่น MG)"
                  value={ingredient.numeratorUnitCode}
                  onChange={(event) =>
                    updateIngredientField(index, "numeratorUnitCode", event.target.value)
                  }
                />
                <input
                  type="text"
                  placeholder="ตัวหาร (ถ้ามี)"
                  value={ingredient.strengthDenominator}
                  onChange={(event) =>
                    updateIngredientField(index, "strengthDenominator", event.target.value)
                  }
                />
                <input
                  type="text"
                  placeholder="หน่วยตัวหาร (เช่น ML)"
                  value={ingredient.denominatorUnitCode}
                  onChange={(event) =>
                    updateIngredientField(index, "denominatorUnitCode", event.target.value)
                  }
                />
                <button
                  type="button"
                  className="products-btn small danger"
                  onClick={() => removeIngredientRow(index)}
                >
                  ลบ
                </button>
              </div>
            ))}
            <p className="products-ingredient-hint">
              ตัวอย่าง: Paracetamol 500 MG, หรือ Amoxicillin 125 MG / 5 ML
            </p>
          </div>
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
              <th>บาร์โค้ด</th>
              <th>ชื่อการค้า</th>
              <th>ผู้ผลิต/ผู้นำเข้า</th>
              <th>ชื่อสามัญ</th>
              <th>บรรจุภัณฑ์</th>
              <th>ราคา</th>
              <th>ชนิดรายงาน</th>
              <th>รูปแบบยา</th>
              <th>สถานะ</th>
              <th>การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11}>กำลังโหลด...</td>
              </tr>
            ) : items.length ? (
              items.map((item) => (
                <tr key={item.id}>
                  <td>{item.productCode || "-"}</td>
                  <td>{item.barcode || "-"}</td>
                  <td>{item.tradeName}</td>
                  <td>{item.manufacturerName || "-"}</td>
                  <td>{item.genericName || "-"}</td>
                  <td>
                    {item.packageSize || "-"}
                    {item.unitTypeCode ? ` (${item.unitTypeCode})` : ""}
                  </td>
                  <td>
                    {item.price === null || item.price === undefined
                      ? "-"
                      : Number(item.price).toFixed(2)}
                  </td>
                  <td>
                    {Array.isArray(item.reportGroupCodes) && item.reportGroupCodes.length
                      ? item.reportGroupCodes.join(", ")
                      : "-"}
                  </td>
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
                <td colSpan={11}>ไม่พบข้อมูล</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
