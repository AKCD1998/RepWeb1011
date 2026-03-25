import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { productsApi } from "../lib/api";
import "./Products.css";

const EMPTY_INGREDIENT = {
  activeIngredientId: "",
  activeIngredientCode: "",
  nameEn: "",
  nameTh: "",
  useCustomActiveIngredient: false,
  strengthNumerator: "",
  numeratorUnitCode: "",
  useCustomNumeratorUnit: false,
  strengthDenominator: "",
  denominatorUnitCode: "",
  useCustomDenominatorUnit: false,
};

const PACKAGE_SIZE_OPTIONS = [
  "1 กระปุก x 60 เม็ด",
  "1 กล่อง x 100 แผง x 10 เม็ด",
  "1 กล่อง x 10 แผง x 10 เม็ด",
  "1 กล่อง x 1 ขวด x 30 mL",
  "1 กล่อง x 1 ขวด x 60 mL",
  "1 กล่อง x 1 ตลับ x 60 inhalations",
  "1 กล่อง x 1 แผง x 10 เม็ด",
  "1 กล่อง x 1 หลอด x 10 กรัม",
  "1 กล่อง x 1 หลอด x 120 doses",
  "1 กล่อง x 1 หลอด x 120 metered actuations",
  "1 กล่อง x 1 หลอด x 200 metered actuations",
  "1 กล่อง x 20 แผง x 10 เม็ด",
  "1 กล่อง x 25 แผง x 10 เม็ด",
  "1 กล่อง x 25 แผง x 4 เม็ด",
  "1 กล่อง x 3 แผง x 10 เม็ด",
  "1 กล่อง x 50 แผง x 10 เม็ด",
  "1 แผง x 10 เม็ด",
];

const UNIT_TYPE_CODE_OPTIONS = [
  "ACCUHALER",
  "BLISTER",
  "BOTTLE",
  "BOX",
  "MDI",
  "TUBE",
  "TURBUHALER",
];

const DOSAGE_FORM_CODE_OPTIONS = [
  "INHALER",
  "OINTMENT",
  "ORAL_SOLUTION",
  "SOFT_GEL",
  "TABLET",
];
const CUSTOM_GENERIC_VALUE = "__CUSTOM__";
const CUSTOM_ACTIVE_INGREDIENT_VALUE = "__CUSTOM_ACTIVE_INGREDIENT__";
const CUSTOM_NUMERATOR_UNIT_VALUE = "__CUSTOM_NUMERATOR_UNIT__";
const CUSTOM_DENOMINATOR_UNIT_VALUE = "__CUSTOM_DENOMINATOR_UNIT__";

function createEmptyIngredient() {
  return { ...EMPTY_INGREDIENT };
}

function getIngredientNameKey(value) {
  return String(value || "").trim().toUpperCase();
}

function getUnitCodeKey(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeActiveIngredientOptions(payload) {
  const rows = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  const byId = new Map();

  for (const row of rows) {
    const id = String(row?.id || "").trim();
    const nameEn = String(row?.nameEn ?? row?.name_en ?? "").trim();
    if (!id || !nameEn) continue;
    byId.set(id, {
      id,
      code: String(row?.code || "").trim().toUpperCase(),
      nameEn,
    });
  }

  return [...byId.values()].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
}

function normalizeUnitTypeOptions(payload) {
  const rows = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  const byCode = new Map();

  for (const row of rows) {
    const code = getUnitCodeKey(row?.code);
    if (!code) continue;
    byCode.set(code, {
      id: String(row?.id || "").trim(),
      code,
      nameEn: String(row?.nameEn ?? "").trim(),
      symbol: String(row?.symbol || "").trim(),
    });
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
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
    !String(ingredient?.activeIngredientId || "").trim() &&
    !String(ingredient?.activeIngredientCode || "").trim() &&
    !String(ingredient?.nameEn || "").trim() &&
    !String(ingredient?.nameTh || "").trim() &&
    !String(ingredient?.strengthNumerator || "").trim() &&
    !String(ingredient?.numeratorUnitCode || "").trim() &&
    !String(ingredient?.strengthDenominator || "").trim() &&
    !String(ingredient?.denominatorUnitCode || "").trim()
  );
}

function normalizeIngredientForForm(
  ingredient,
  activeIngredientOptionsByName = new Map(),
  unitTypeOptionsByCode = new Map()
) {
  const nameEn = ingredient?.nameEn || "";
  const activeIngredientIdRaw = String(
    ingredient?.activeIngredientId ?? ingredient?.ingredientId ?? ""
  ).trim();
  const matchedOption =
    !activeIngredientIdRaw && nameEn
      ? activeIngredientOptionsByName.get(getIngredientNameKey(nameEn))
      : null;
  const activeIngredientId = activeIngredientIdRaw || matchedOption?.id || "";
  const numeratorUnitCodeRaw = getUnitCodeKey(ingredient?.numeratorUnitCode);
  const denominatorUnitCodeRaw = getUnitCodeKey(ingredient?.denominatorUnitCode);
  const numeratorUnitOption = numeratorUnitCodeRaw
    ? unitTypeOptionsByCode.get(numeratorUnitCodeRaw)
    : null;
  const denominatorUnitOption = denominatorUnitCodeRaw
    ? unitTypeOptionsByCode.get(denominatorUnitCodeRaw)
    : null;

  return {
    activeIngredientId,
    activeIngredientCode:
      ingredient?.activeIngredientCode || (activeIngredientIdRaw ? "" : matchedOption?.code || ""),
    nameEn: activeIngredientIdRaw ? nameEn : matchedOption?.nameEn || nameEn,
    nameTh: ingredient?.nameTh || "",
    useCustomActiveIngredient: !activeIngredientId && Boolean(nameEn),
    strengthNumerator:
      ingredient?.strengthNumerator === null || ingredient?.strengthNumerator === undefined
        ? ""
        : String(ingredient.strengthNumerator),
    numeratorUnitCode: numeratorUnitOption?.code || numeratorUnitCodeRaw,
    useCustomNumeratorUnit: Boolean(numeratorUnitCodeRaw) && !numeratorUnitOption,
    strengthDenominator:
      ingredient?.strengthDenominator === null || ingredient?.strengthDenominator === undefined
        ? ""
        : String(ingredient.strengthDenominator),
    denominatorUnitCode: denominatorUnitOption?.code || denominatorUnitCodeRaw,
    useCustomDenominatorUnit: Boolean(denominatorUnitCodeRaw) && !denominatorUnitOption,
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
  const [genericNameOptions, setGenericNameOptions] = useState([]);
  const [activeIngredientOptions, setActiveIngredientOptions] = useState([]);
  const [ingredientUnitOptions, setIngredientUnitOptions] = useState([]);
  const [genericSelection, setGenericSelection] = useState("");
  const [customGenericName, setCustomGenericName] = useState("");
  const [isLoadingGenericNames, setIsLoadingGenericNames] = useState(false);
  const [genericNamesError, setGenericNamesError] = useState("");
  const [isLoadingActiveIngredients, setIsLoadingActiveIngredients] = useState(false);
  const [activeIngredientsError, setActiveIngredientsError] = useState("");
  const [isLoadingIngredientUnits, setIsLoadingIngredientUnits] = useState(false);
  const [ingredientUnitsError, setIngredientUnitsError] = useState("");
  const [activeIngredientSearch, setActiveIngredientSearch] = useState("");
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [form, setForm] = useState(createEmptyForm);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [statusText, setStatusText] = useState("");
  const customGenericInputRef = useRef(null);
  const activeIngredientsCacheRef = useRef(new Map());
  const ingredientUnitsCacheRef = useRef(new Map());

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

  const loadActiveIngredients = useCallback(async (searchValue) => {
    const normalizedSearch = String(searchValue || "").trim();
    const cacheKey = normalizedSearch.toUpperCase();
    const cached = activeIngredientsCacheRef.current.get(cacheKey);
    if (cached) {
      setActiveIngredientOptions(cached);
      setActiveIngredientsError("");
      return;
    }

    setIsLoadingActiveIngredients(true);
    setActiveIngredientsError("");
    try {
      const payload = await productsApi.activeIngredients(normalizedSearch);
      const options = normalizeActiveIngredientOptions(payload);
      activeIngredientsCacheRef.current.set(cacheKey, options);
      setActiveIngredientOptions(options);
    } catch (error) {
      setActiveIngredientOptions([]);
      setActiveIngredientsError(normalizeApiError(error));
    } finally {
      setIsLoadingActiveIngredients(false);
    }
  }, []);

  const loadIngredientUnits = useCallback(async (searchValue = "") => {
    const normalizedSearch = String(searchValue || "").trim();
    const cacheKey = normalizedSearch.toUpperCase();
    const cached = ingredientUnitsCacheRef.current.get(cacheKey);
    if (cached) {
      setIngredientUnitOptions(cached);
      setIngredientUnitsError("");
      return;
    }

    setIsLoadingIngredientUnits(true);
    setIngredientUnitsError("");
    try {
      const payload = await productsApi.unitTypes(normalizedSearch);
      const options = normalizeUnitTypeOptions(payload);
      ingredientUnitsCacheRef.current.set(cacheKey, options);
      setIngredientUnitOptions(options);
    } catch (error) {
      setIngredientUnitOptions([]);
      setIngredientUnitsError(normalizeApiError(error));
    } finally {
      setIsLoadingIngredientUnits(false);
    }
  }, []);

  const syncGenericControls = useCallback(
    (rawGenericName, sourceOptions = genericNameOptions) => {
      const normalized = String(rawGenericName || "").trim().toUpperCase();
      if (!normalized) {
        setGenericSelection("");
        setCustomGenericName("");
        return;
      }

      if (sourceOptions.includes(normalized)) {
        setGenericSelection(normalized);
        setCustomGenericName("");
        return;
      }

      setGenericSelection(CUSTOM_GENERIC_VALUE);
      setCustomGenericName(normalized);
    },
    [genericNameOptions]
  );

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

  useEffect(() => {
    let cancelled = false;
    setIsLoadingGenericNames(true);
    setGenericNamesError("");

    productsApi
      .genericNames()
      .then((payload) => {
        if (cancelled) return;
        const rawRows = Array.isArray(payload?.generic_names)
          ? payload.generic_names
          : Array.isArray(payload)
            ? payload
            : [];
        const normalizedRows = [...new Set(rawRows.map((value) => String(value || "").trim().toUpperCase()))]
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
        setGenericNameOptions(normalizedRows);
      })
      .catch((error) => {
        if (cancelled) return;
        setGenericNameOptions([]);
        setGenericNamesError(normalizeApiError(error));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingGenericNames(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadActiveIngredients(activeIngredientSearch);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeIngredientSearch, loadActiveIngredients]);

  useEffect(() => {
    loadIngredientUnits("");
  }, [loadIngredientUnits]);

  useEffect(() => {
    syncGenericControls(form.genericName, genericNameOptions);
  }, [genericNameOptions, syncGenericControls]);

  useEffect(() => {
    if (genericSelection !== CUSTOM_GENERIC_VALUE) return;
    customGenericInputRef.current?.focus();
  }, [genericSelection]);

  const isEditMode = Boolean(editingId);
  const activeIngredientOptionsById = useMemo(
    () => new Map(activeIngredientOptions.map((option) => [option.id, option])),
    [activeIngredientOptions]
  );
  const activeIngredientOptionsByName = useMemo(
    () =>
      new Map(activeIngredientOptions.map((option) => [getIngredientNameKey(option.nameEn), option])),
    [activeIngredientOptions]
  );
  const ingredientUnitOptionsByCode = useMemo(
    () => new Map(ingredientUnitOptions.map((option) => [option.code, option])),
    [ingredientUnitOptions]
  );
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
  const packageSizeOptions = useMemo(() => PACKAGE_SIZE_OPTIONS, []);
  const isLegacyPackageSizeValue = useMemo(() => {
    if (!form.packageSize) return false;
    return !packageSizeOptions.includes(form.packageSize);
  }, [form.packageSize, packageSizeOptions]);
  const unitTypeCodeOptions = useMemo(() => UNIT_TYPE_CODE_OPTIONS, []);
  const isLegacyUnitTypeCodeValue = useMemo(() => {
    if (!form.unitTypeCode) return false;
    return !unitTypeCodeOptions.includes(form.unitTypeCode);
  }, [form.unitTypeCode, unitTypeCodeOptions]);
  const dosageFormCodeOptions = useMemo(() => DOSAGE_FORM_CODE_OPTIONS, []);
  const isLegacyDosageFormCodeValue = useMemo(() => {
    if (!form.dosageFormCode) return false;
    return !dosageFormCodeOptions.includes(form.dosageFormCode);
  }, [form.dosageFormCode, dosageFormCodeOptions]);
  const genericNameValueForSubmit = useMemo(() => {
    if (genericSelection === CUSTOM_GENERIC_VALUE) {
      return customGenericName.trim();
    }
    return String(genericSelection || "").trim();
  }, [customGenericName, genericSelection]);

  useEffect(() => {
    if (!isEditMode || !activeIngredientOptionsByName.size) return;

    setForm((prev) => {
      let changed = false;
      const nextIngredients = prev.ingredients.map((ingredient) => {
        if (!ingredient.useCustomActiveIngredient || ingredient.activeIngredientId) {
          return ingredient;
        }
        const matched = activeIngredientOptionsByName.get(getIngredientNameKey(ingredient.nameEn));
        if (!matched) return ingredient;
        changed = true;
        return {
          ...ingredient,
          activeIngredientId: matched.id,
          activeIngredientCode: matched.code || ingredient.activeIngredientCode,
          nameEn: matched.nameEn,
          useCustomActiveIngredient: false,
        };
      });

      if (!changed) return prev;
      return { ...prev, ingredients: nextIngredients };
    });
  }, [activeIngredientOptionsByName, isEditMode]);

  useEffect(() => {
    if (!isEditMode || !ingredientUnitOptionsByCode.size) return;

    setForm((prev) => {
      let changed = false;
      const nextIngredients = prev.ingredients.map((ingredient) => {
        let nextIngredient = ingredient;

        if (ingredient.useCustomNumeratorUnit) {
          const numeratorUnitCode = getUnitCodeKey(ingredient.numeratorUnitCode);
          const matchedNumerator = ingredientUnitOptionsByCode.get(numeratorUnitCode);
          if (matchedNumerator) {
            nextIngredient = {
              ...nextIngredient,
              numeratorUnitCode: matchedNumerator.code,
              useCustomNumeratorUnit: false,
            };
            changed = true;
          }
        }

        if (ingredient.useCustomDenominatorUnit) {
          const denominatorUnitCode = getUnitCodeKey(ingredient.denominatorUnitCode);
          const matchedDenominator = ingredientUnitOptionsByCode.get(denominatorUnitCode);
          if (matchedDenominator) {
            nextIngredient = {
              ...nextIngredient,
              denominatorUnitCode: matchedDenominator.code,
              useCustomDenominatorUnit: false,
            };
            changed = true;
          }
        }

        return nextIngredient;
      });

      if (!changed) return prev;
      return { ...prev, ingredients: nextIngredients };
    });
  }, [ingredientUnitOptionsByCode, isEditMode]);

  const handleGenericSelectionChange = (event) => {
    const nextValue = String(event.target.value || "").trim();
    setGenericSelection(nextValue);
    setGenericNamesError("");

    if (nextValue === CUSTOM_GENERIC_VALUE) {
      setCustomGenericName("");
      setForm((prev) => ({ ...prev, genericName: "" }));
      return;
    }

    setCustomGenericName("");
    setForm((prev) => ({ ...prev, genericName: nextValue }));
  };

  const handleCustomGenericNameChange = (event) => {
    const nextValue = String(event.target.value || "").toUpperCase();
    setCustomGenericName(nextValue);
    setForm((prev) => ({ ...prev, genericName: nextValue }));
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setQuery(searchInput.trim());
  };

  const resetForm = () => {
    setForm(createEmptyForm());
    setEditingId("");
    setGenericSelection("");
    setCustomGenericName("");
  };

  const updateIngredientField = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) =>
        currentIndex === index ? { ...ingredient, [field]: value } : ingredient
      ),
    }));
  };

  const getIngredientSelectValue = (ingredient) => {
    if (ingredient.useCustomActiveIngredient) return CUSTOM_ACTIVE_INGREDIENT_VALUE;
    return ingredient.activeIngredientId || "";
  };

  const handleIngredientSelectionChange = (index, selectedValue) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) => {
        if (currentIndex !== index) return ingredient;

        const nextValue = String(selectedValue || "").trim();
        if (nextValue === CUSTOM_ACTIVE_INGREDIENT_VALUE) {
          return {
            ...ingredient,
            activeIngredientId: "",
            activeIngredientCode: "",
            nameEn: "",
            useCustomActiveIngredient: true,
          };
        }

        if (!nextValue) {
          return {
            ...ingredient,
            activeIngredientId: "",
            activeIngredientCode: "",
            nameEn: "",
            useCustomActiveIngredient: false,
          };
        }

        const selectedOption = activeIngredientOptionsById.get(nextValue);
        return {
          ...ingredient,
          activeIngredientId: nextValue,
          activeIngredientCode: selectedOption?.code || "",
          nameEn: selectedOption?.nameEn || ingredient.nameEn,
          useCustomActiveIngredient: false,
        };
      }),
    }));
  };

  const handleCustomIngredientNameChange = (index, value) => {
    const nextValue = String(value || "").toUpperCase();
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) =>
        currentIndex === index
          ? {
              ...ingredient,
              activeIngredientId: "",
              activeIngredientCode: "",
              nameEn: nextValue,
              useCustomActiveIngredient: true,
            }
          : ingredient
      ),
    }));
  };

  const getNumeratorUnitSelectValue = (ingredient) => {
    if (ingredient.useCustomNumeratorUnit) return CUSTOM_NUMERATOR_UNIT_VALUE;
    return getUnitCodeKey(ingredient.numeratorUnitCode);
  };

  const getDenominatorUnitSelectValue = (ingredient) => {
    if (ingredient.useCustomDenominatorUnit) return CUSTOM_DENOMINATOR_UNIT_VALUE;
    return getUnitCodeKey(ingredient.denominatorUnitCode);
  };

  const handleNumeratorUnitSelectionChange = (index, selectedValue) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) => {
        if (currentIndex !== index) return ingredient;

        const nextValue = String(selectedValue || "").trim();
        if (nextValue === CUSTOM_NUMERATOR_UNIT_VALUE) {
          return {
            ...ingredient,
            numeratorUnitCode: "",
            useCustomNumeratorUnit: true,
          };
        }
        if (!nextValue) {
          return {
            ...ingredient,
            numeratorUnitCode: "",
            useCustomNumeratorUnit: false,
          };
        }
        return {
          ...ingredient,
          numeratorUnitCode: getUnitCodeKey(nextValue),
          useCustomNumeratorUnit: false,
        };
      }),
    }));
  };

  const handleDenominatorUnitSelectionChange = (index, selectedValue) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) => {
        if (currentIndex !== index) return ingredient;

        const nextValue = String(selectedValue || "").trim();
        if (nextValue === CUSTOM_DENOMINATOR_UNIT_VALUE) {
          return {
            ...ingredient,
            denominatorUnitCode: "",
            useCustomDenominatorUnit: true,
          };
        }
        if (!nextValue) {
          return {
            ...ingredient,
            denominatorUnitCode: "",
            useCustomDenominatorUnit: false,
          };
        }
        return {
          ...ingredient,
          denominatorUnitCode: getUnitCodeKey(nextValue),
          useCustomDenominatorUnit: false,
        };
      }),
    }));
  };

  const handleCustomNumeratorUnitChange = (index, value) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) =>
        currentIndex === index
          ? {
              ...ingredient,
              numeratorUnitCode: getUnitCodeKey(value),
              useCustomNumeratorUnit: true,
            }
          : ingredient
      ),
    }));
  };

  const handleCustomDenominatorUnitChange = (index, value) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient, currentIndex) =>
        currentIndex === index
          ? {
              ...ingredient,
              denominatorUnitCode: getUnitCodeKey(value),
              useCustomDenominatorUnit: true,
            }
          : ingredient
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
          activeIngredientId: ingredient.activeIngredientId.trim() || null,
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
        genericName: genericNameValueForSubmit || null,
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
        ? item.ingredients.map((ingredient) =>
            normalizeIngredientForForm(
              ingredient,
              activeIngredientOptionsByName,
              ingredientUnitOptionsByCode
            )
          )
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
    syncGenericControls(item.genericName || "");
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
          <label className="products-generic-field">
            ชื่อสามัญ (สรุป)
            <select
              value={genericSelection}
              onChange={handleGenericSelectionChange}
              disabled={isLoadingGenericNames}
            >
              <option value="">เลือกชื่อสามัญ (สรุป)</option>
              {genericNameOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value={CUSTOM_GENERIC_VALUE}>กำหนดเอง (กรณีสูตรยาใหม่)</option>
            </select>
            {genericSelection === CUSTOM_GENERIC_VALUE ? (
              <input
                ref={customGenericInputRef}
                type="text"
                className="products-generic-custom-input"
                value={customGenericName}
                onChange={handleCustomGenericNameChange}
                placeholder="ระบุชื่อสามัญใหม่"
              />
            ) : null}
            {isLoadingGenericNames ? (
              <small className="products-generic-help">กำลังโหลดรายการชื่อสามัญ...</small>
            ) : null}
            {genericNamesError ? (
              <small className="products-generic-help products-generic-help--error">
                โหลดรายการชื่อสามัญไม่สำเร็จ สามารถเลือกกำหนดเองได้
              </small>
            ) : null}
          </label>
          <label>
            ขนาดบรรจุภัณฑ์
            <select
              value={form.packageSize}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, packageSize: event.target.value }))
              }
            >
              <option value="">เลือกขนาดบรรจุภัณฑ์</option>
              {isLegacyPackageSizeValue ? (
                <option value={form.packageSize}>{`${form.packageSize} (legacy)`}</option>
              ) : null}
              {packageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dosage Form Code
            <select
              value={form.dosageFormCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, dosageFormCode: event.target.value }))
              }
            >
              <option value="">เลือก Dosage Form Code</option>
              {isLegacyDosageFormCodeValue ? (
                <option value={form.dosageFormCode}>{`${form.dosageFormCode} (legacy)`}</option>
              ) : null}
              {dosageFormCodeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            Unit Type Code
            <select
              value={form.unitTypeCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, unitTypeCode: event.target.value }))
              }
            >
              <option value="">เลือก Unit Type Code</option>
              {isLegacyUnitTypeCodeValue ? (
                <option value={form.unitTypeCode}>{`${form.unitTypeCode} (legacy)`}</option>
              ) : null}
              {unitTypeCodeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
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
            <input
              type="text"
              className="products-ingredient-search"
              value={activeIngredientSearch}
              onChange={(event) => setActiveIngredientSearch(event.target.value)}
              placeholder="ค้นหาสารสำคัญ (EN / code)"
            />
            {isLoadingActiveIngredients ? (
              <p className="products-ingredient-help">กำลังโหลดรายการสารสำคัญ...</p>
            ) : null}
            {activeIngredientsError ? (
              <p className="products-ingredient-help products-ingredient-help--error">
                โหลดรายการสารสำคัญไม่สำเร็จ สามารถเลือกกำหนดเองได้
              </p>
            ) : null}
            {isLoadingIngredientUnits ? (
              <p className="products-ingredient-help">กำลังโหลดรายการหน่วย...</p>
            ) : null}
            {ingredientUnitsError ? (
              <p className="products-ingredient-help products-ingredient-help--error">
                โหลดรายการหน่วยไม่สำเร็จ สามารถกำหนดเองได้
              </p>
            ) : null}
            {form.ingredients.map((ingredient, index) => {
              const hasMissingSelectedOption =
                Boolean(ingredient.activeIngredientId) &&
                !activeIngredientOptionsById.has(ingredient.activeIngredientId);
              const numeratorUnitCode = getUnitCodeKey(ingredient.numeratorUnitCode);
              const denominatorUnitCode = getUnitCodeKey(ingredient.denominatorUnitCode);
              const hasMissingNumeratorOption =
                Boolean(numeratorUnitCode) && !ingredientUnitOptionsByCode.has(numeratorUnitCode);
              const hasMissingDenominatorOption =
                Boolean(denominatorUnitCode) &&
                !ingredientUnitOptionsByCode.has(denominatorUnitCode);

              return (
                <div className="products-ingredient-row" key={`ingredient-${index}`}>
                  <div className="products-ingredient-name-field">
                    <select
                      value={getIngredientSelectValue(ingredient)}
                      onChange={(event) => handleIngredientSelectionChange(index, event.target.value)}
                      disabled={isLoadingActiveIngredients}
                    >
                      <option value="">เลือกสารสำคัญ (EN) *</option>
                      {hasMissingSelectedOption ? (
                        <option value={ingredient.activeIngredientId}>
                          {ingredient.nameEn || ingredient.activeIngredientCode || "(legacy)"}
                        </option>
                      ) : null}
                      {activeIngredientOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.nameEn}
                        </option>
                      ))}
                      <option value={CUSTOM_ACTIVE_INGREDIENT_VALUE}>
                        กำหนดเอง (กรณีตัวยาใหม่)
                      </option>
                    </select>
                    {ingredient.useCustomActiveIngredient ? (
                      <input
                        type="text"
                        placeholder="ชื่อสารสำคัญใหม่ (EN) *"
                        value={ingredient.nameEn}
                        onChange={(event) =>
                          handleCustomIngredientNameChange(index, event.target.value)
                        }
                      />
                    ) : null}
                  </div>
                  <input
                    type="text"
                    placeholder="ความแรง"
                    value={ingredient.strengthNumerator}
                    onChange={(event) =>
                      updateIngredientField(index, "strengthNumerator", event.target.value)
                    }
                  />
                  <div className="products-ingredient-unit-field">
                    <select
                      value={getNumeratorUnitSelectValue(ingredient)}
                      onChange={(event) =>
                        handleNumeratorUnitSelectionChange(index, event.target.value)
                      }
                      disabled={isLoadingIngredientUnits}
                    >
                      <option value="">หน่วยตัวตั้ง (เช่น MG)</option>
                      {hasMissingNumeratorOption ? (
                        <option value={numeratorUnitCode}>{numeratorUnitCode}</option>
                      ) : null}
                      {ingredientUnitOptions.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.code}
                          {option.symbol ? ` (${option.symbol})` : ""}
                        </option>
                      ))}
                      <option value={CUSTOM_NUMERATOR_UNIT_VALUE}>กำหนดเอง</option>
                    </select>
                    {ingredient.useCustomNumeratorUnit ? (
                      <input
                        type="text"
                        placeholder="ระบุหน่วยตัวตั้ง (เช่น MG)"
                        value={ingredient.numeratorUnitCode}
                        onChange={(event) =>
                          handleCustomNumeratorUnitChange(index, event.target.value)
                        }
                      />
                    ) : null}
                  </div>
                  <input
                    type="text"
                    placeholder="ตัวหาร (ถ้ามี)"
                    value={ingredient.strengthDenominator}
                    onChange={(event) =>
                      updateIngredientField(index, "strengthDenominator", event.target.value)
                    }
                  />
                  <div className="products-ingredient-unit-field">
                    <select
                      value={getDenominatorUnitSelectValue(ingredient)}
                      onChange={(event) =>
                        handleDenominatorUnitSelectionChange(index, event.target.value)
                      }
                      disabled={isLoadingIngredientUnits}
                    >
                      <option value="">หน่วยตัวหาร (เช่น ML)</option>
                      {hasMissingDenominatorOption ? (
                        <option value={denominatorUnitCode}>{denominatorUnitCode}</option>
                      ) : null}
                      {ingredientUnitOptions.map((option) => (
                        <option key={`${option.code}-den`} value={option.code}>
                          {option.code}
                          {option.symbol ? ` (${option.symbol})` : ""}
                        </option>
                      ))}
                      <option value={CUSTOM_DENOMINATOR_UNIT_VALUE}>กำหนดเอง</option>
                    </select>
                    {ingredient.useCustomDenominatorUnit ? (
                      <input
                        type="text"
                        placeholder="ระบุหน่วยตัวหาร (เช่น ML)"
                        value={ingredient.denominatorUnitCode}
                        onChange={(event) =>
                          handleCustomDenominatorUnitChange(index, event.target.value)
                        }
                      />
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="products-btn small danger"
                    onClick={() => removeIngredientRow(index)}
                  >
                    ลบ
                  </button>
                </div>
              );
            })}
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
