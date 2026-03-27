import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { dispenseApi, inventoryApi } from "../lib/api";
import { parseDeliverNotes } from "../utils/deliverPatientParser";
import {
  SMARTCARD_DEFAULTS,
  buildDeliverNotesFromCard,
  startSmartcardListener,
} from "../utils/deliverSmartcard";
import {
  fetchProductLots,
  hydrateProductMetadata,
  productLookup,
  syncSnapshot,
} from "../utils/deliverCache";
import "./Deliver.css";

const toMoney = (value) => Number(value || 0).toFixed(2);
const REPORT_TYPE_META = {
  KY10: "KY10 - ขย.10 ยาควบคุมพิเศษ",
  KY11: "KY11 - ขย.11 ยาอันตรายที่ต้องมีการควบคุมปริมาณการจำหน่าย",
};
const SUPPORTED_REPORT_TYPES = new Set(Object.keys(REPORT_TYPE_META));
const SMARTCARD_BROKER_URL =
  toCleanText(import.meta.env.VITE_SMARTCARD_MQTT_URL) ||
  SMARTCARD_DEFAULTS.brokerUrl;
const SMARTCARD_TOPIC =
  toCleanText(import.meta.env.VITE_SMARTCARD_MQTT_TOPIC) ||
  SMARTCARD_DEFAULTS.topic;
const SMARTCARD_DUPLICATE_WINDOW_MS = 10000;

function toCleanText(value) {
  return String(value || "").trim();
}

function toItemKey(value) {
  return toCleanText(value).toLowerCase();
}

function toDateLabel(value) {
  const text = toCleanText(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  return date.toISOString().slice(0, 10);
}

function buildLineNote(item, fallbackReportType = "") {
  const metadata = [];
  const reportType = toCleanText(item?.reportType || fallbackReportType).toUpperCase();
  if (SUPPORTED_REPORT_TYPES.has(reportType)) {
    metadata.push(`reportType=${reportType}`);
  }

  const lotNo = toCleanText(item?.lotNo);
  if (lotNo) {
    metadata.push(`lotNo=${lotNo}`);
  }

  if (!metadata.length) return null;
  return `[${metadata.join(" ")}]`;
}

export default function Deliver() {
  const { user } = useAuth();
  const userRole = toCleanText(user?.role).toUpperCase();
  const isAdmin = userRole === "ADMIN";
  const userBranchCode = toCleanText(user?.branchCode || user?.branch_code || "");
  const [items, setItems] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingMultiplier, setPendingMultiplier] = useState(null);
  const [deliverNotes, setDeliverNotes] = useState("");
  const [reportTypeOptions, setReportTypeOptions] = useState([]);
  const [selectedReportType, setSelectedReportType] = useState("");
  const [lotOptions, setLotOptions] = useState([]);
  const [selectedLotId, setSelectedLotId] = useState("");
  const [selectedProductName, setSelectedProductName] = useState("");
  const [activeItemKey, setActiveItemKey] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [branchOptions, setBranchOptions] = useState([]);
  const [selectedBranchCode, setSelectedBranchCode] = useState(userBranchCode);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [branchLoadError, setBranchLoadError] = useState("");
  const [smartcardStatus, setSmartcardStatus] = useState({
    tone: "info",
    message: "กำลังเริ่ม smartcard listener",
  });
  const barcodeInputRef = useRef(null);
  const lotOptionsCacheRef = useRef(new Map());
  const deliverNotesRef = useRef("");
  const lastAutoFilledNotesRef = useRef("");
  const lastSmartcardFillRef = useRef({ signature: "", at: 0 });

  const parsedNotes = useMemo(() => parseDeliverNotes(deliverNotes), [deliverNotes]);

  useEffect(() => {
    deliverNotesRef.current = deliverNotes;
  }, [deliverNotes]);

  useEffect(() => {
    setSelectedBranchCode(userBranchCode);
  }, [userBranchCode]);

  useEffect(() => {
    syncSnapshot().catch(() => {});
  }, []);

  const handleSmartcardData = useCallback((normalized) => {
    const nextNotes = buildDeliverNotesFromCard(normalized?.fields);
    if (!nextNotes) {
      console.warn("[deliver-smartcard] no usable card fields for note autofill", normalized);
      setSmartcardStatus({
        tone: "warn",
        message: "ได้รับข้อมูลบัตรแล้ว แต่ยังไม่มีฟิลด์ที่ใช้กรอกผู้รับมอบยาได้",
      });
      return;
    }

    const currentNotes = deliverNotesRef.current;
    const canReplaceCurrentNotes =
      !toCleanText(currentNotes) || currentNotes === lastAutoFilledNotesRef.current;
    const now = Date.now();
    const duplicateWithinWindow =
      lastSmartcardFillRef.current.signature === nextNotes &&
      now - lastSmartcardFillRef.current.at < SMARTCARD_DUPLICATE_WINDOW_MS;

    if (duplicateWithinWindow && (!canReplaceCurrentNotes || currentNotes === lastAutoFilledNotesRef.current)) {
      lastSmartcardFillRef.current = { signature: nextNotes, at: now };
      console.debug("[deliver-smartcard] duplicate card event ignored", {
        duplicateWindowMs: SMARTCARD_DUPLICATE_WINDOW_MS,
        note: nextNotes,
      });
      setSmartcardStatus({
        tone: "info",
        message: "ได้รับ event ซ้ำของบัตรเดิม ระบบจึงไม่กรอกข้อความซ้ำ",
      });
      return;
    }

    lastSmartcardFillRef.current = { signature: nextNotes, at: now };

    if (!canReplaceCurrentNotes) {
      console.info("[deliver-smartcard] card data received but notes were preserved", {
        note: nextNotes,
      });
      setSmartcardStatus({
        tone: "warn",
        message:
          "ได้รับข้อมูลบัตรแล้ว แต่ช่องหมายเหตุถูกแก้ไขเอง ระบบจึงไม่เขียนทับอัตโนมัติ",
      });
      return;
    }

    lastAutoFilledNotesRef.current = nextNotes;
    deliverNotesRef.current = nextNotes;
    setDeliverNotes(nextNotes);

    const patientName = toCleanText(
      normalized?.fields?.thaiName ||
        normalized?.fields?.fullName ||
        normalized?.fields?.englishName
    );

    setSmartcardStatus({
      tone: "success",
      message: patientName
        ? `ดึงข้อมูลบัตรสำเร็จและกรอกผู้รับมอบยา: ${patientName}`
        : "ดึงข้อมูลบัตรสำเร็จและกรอกข้อมูลลงในช่องผู้รับมอบยาแล้ว",
    });
  }, []);

  useEffect(() => {
    const stopSmartcardListener = startSmartcardListener({
      brokerUrl: SMARTCARD_BROKER_URL,
      topic: SMARTCARD_TOPIC,
      onStatusChange: (nextStatus) => {
        setSmartcardStatus({
          tone: nextStatus?.tone || "info",
          message: nextStatus?.message || "smartcard listener ทำงานอยู่",
        });
      },
      onCardData: handleSmartcardData,
    });

    return () => {
      stopSmartcardListener();
    };
  }, [handleSmartcardData]);

  const loadBranchOptions = useCallback(async () => {
    if (!isAdmin) {
      setBranchOptions([]);
      setBranchLoadError("");
      setIsLoadingBranches(false);
      return;
    }

    setIsLoadingBranches(true);
    try {
      const rows = await inventoryApi.listLocations({
        includeInactive: false,
        locationType: "BRANCH",
      });
      const normalized = (Array.isArray(rows) ? rows : [])
        .map((row) => ({
          id: toCleanText(row?.id),
          code: toCleanText(row?.code),
          name: toCleanText(row?.name),
        }))
        .filter((row) => row.code)
        .sort((a, b) => {
          if (a.code !== b.code) return a.code.localeCompare(b.code);
          return a.name.localeCompare(b.name);
        });
      setBranchOptions(normalized);
      setBranchLoadError("");
    } catch (error) {
      setBranchOptions([]);
      setBranchLoadError(error?.message || "ไม่สามารถโหลดรายการสาขาได้");
    } finally {
      setIsLoadingBranches(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadBranchOptions();
  }, [loadBranchOptions]);

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const handleKeydown = (event) => {
      if (event.key === "Escape" && !isSubmitting) {
        setIsModalOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [isModalOpen, isSubmitting]);

  const buildReportTypeOptions = useCallback((product) => {
    const rawCodes = Array.isArray(product?.reportGroupCodes)
      ? product.reportGroupCodes
      : [];

    const unique = [];
    rawCodes.forEach((code) => {
      const normalized = String(code || "").trim().toUpperCase();
      if (!SUPPORTED_REPORT_TYPES.has(normalized)) return;
      if (unique.includes(normalized)) return;
      unique.push(normalized);
    });

    return unique.map((code) => ({
      code,
      label: REPORT_TYPE_META[code] || code,
    }));
  }, []);

  const syncProductMeta = useCallback(
    async (product) => {
      const metadata = await hydrateProductMetadata(product);
      const source = metadata || product;
      const itemName = toCleanText(source?.name || product?.name);
      const itemKey = toItemKey(itemName);

      setSelectedProductName(itemName);
      setActiveItemKey(itemKey);

      const nextReportOptions = buildReportTypeOptions(source);
      setReportTypeOptions(nextReportOptions);

      const matchingItem = items.find((item) => toItemKey(item?.name) === itemKey);
      const preferredReportType = toCleanText(
        matchingItem?.reportType || selectedReportType
      ).toUpperCase();
      const resolvedReportType = nextReportOptions.some(
        (option) => option.code === preferredReportType
      )
        ? preferredReportType
        : nextReportOptions[0]?.code || "";
      setSelectedReportType(resolvedReportType);

      const productId = toCleanText(source?.id);
      const productCode = toCleanText(
        source?.productCode ?? source?.companyCode ?? ""
      );
      const lotCacheKey = productId
        ? `id:${productId}`
        : productCode
        ? `code:${productCode}`
        : "";

      if (!lotCacheKey) {
        setLotOptions([]);
        setSelectedLotId("");
        if (itemKey) {
          setItems((prev) =>
            prev.map((item) =>
              toItemKey(item?.name) === itemKey
                ? {
                    ...item,
                    reportType: resolvedReportType,
                    lotNo: "",
                    lotId: "",
                    lotExpDate: "",
                  }
                : item
            )
          );
        }
        return;
      }

      let cachedLots = lotOptionsCacheRef.current.get(lotCacheKey);
      if (!cachedLots) {
        try {
          cachedLots = await fetchProductLots({ productId, productCode });
          lotOptionsCacheRef.current.set(lotCacheKey, cachedLots);
        } catch {
          cachedLots = [];
        }
      }

      setLotOptions(cachedLots);
      const preferredLotId = toCleanText(matchingItem?.lotId || selectedLotId);
      const matchedLot =
        cachedLots.find((option) => toCleanText(option.lotId) === preferredLotId) ||
        cachedLots.find((option) => option.lotNo === toCleanText(matchingItem?.lotNo)) ||
        cachedLots[0] ||
        null;
      const resolvedLotId = toCleanText(matchedLot?.lotId);
      const resolvedLotNo = toCleanText(matchedLot?.lotNo);
      const resolvedLotExpDate = toCleanText(matchedLot?.expDate);

      setSelectedLotId(resolvedLotId);

      if (itemKey) {
        setItems((prev) =>
          prev.map((item) =>
            toItemKey(item?.name) === itemKey
              ? {
                  ...item,
                  reportType: resolvedReportType,
                  lotNo: resolvedLotNo,
                  lotId: resolvedLotId,
                  lotExpDate: resolvedLotExpDate,
                }
              : item
          )
        );
      }
    },
    [buildReportTypeOptions, items, selectedLotId, selectedReportType]
  );

  const parseMultiplier = useCallback((rawValue) => {
    const normalized = String(rawValue ?? "").trim();
    if (!normalized || !/^\d+$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, []);

  const armMultiplierFromInput = useCallback(
    (rawValue) => {
      const nextMultiplier = parseMultiplier(rawValue);
      if (!nextMultiplier) {
        console.warn("จำนวนคูณไม่ถูกต้อง");
        return null;
      }
      setPendingMultiplier(nextMultiplier);
      return nextMultiplier;
    },
    [parseMultiplier]
  );

  const handleAddProduct = useCallback((product, qtyToAdd = 1) => {
    const safeQty = Number(qtyToAdd);
    const resolvedQty = Number.isFinite(safeQty) && safeQty > 0 ? safeQty : 1;
    setItems((prev) => {
      const key = toItemKey(product?.name);
      const index = prev.findIndex((item) => toItemKey(item?.name) === key);

      if (index >= 0) {
        const next = [...prev];
        next[index] = { ...next[index], qty: next[index].qty + resolvedQty };
        return next;
      }

      return [
        ...prev,
        {
          ...product,
          qty: resolvedQty,
          reportType: "",
          lotNo: "",
          lotId: "",
          lotExpDate: "",
        },
      ];
    });
  }, []);

  const handleBarcodeKeyDown = useCallback(
    async (event) => {
      const inputEl = event.currentTarget;
      const key = event.key;
      const code = event.code;
      const isMultiplyKey =
        key === "PageDown" || key === "*" || code === "NumpadMultiply";
      if (isMultiplyKey) {
        event.preventDefault();
        const armedQty = armMultiplierFromInput(inputEl?.value);
        if (armedQty) {
          if (inputEl) {
            inputEl.value = "";
            inputEl.focus();
          }
        }
        return;
      }

      if (key !== "Enter") return;
      event.preventDefault();

      const inputValue = String(inputEl?.value ?? "").trim();
      if (!inputValue) return;

      if (inputEl) {
        inputEl.value = "";
        inputEl.focus();
      }

      try {
        const qtyToAdd = pendingMultiplier ?? 1;
        const product = await productLookup(inputValue);
        if (product) {
          handleAddProduct(product, qtyToAdd);
          setPendingMultiplier(null);
          await syncProductMeta(product);
        } else {
          console.warn("ไม่พบสินค้า/ออฟไลน์");
        }
      } catch (error) {
        console.error("barcode flow failed", error);
      }
    },
    [armMultiplierFromInput, handleAddProduct, pendingMultiplier, syncProductMeta]
  );

  const handleCouponClick = useCallback(() => {
    const input = barcodeInputRef.current;
    if (!input) return;
    const armedQty = armMultiplierFromInput(input.value);
    if (armedQty) {
      input.value = "";
    }
    input.focus();
  }, [armMultiplierFromInput]);

  const handleCouponKeyDown = useCallback(
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      handleCouponClick();
    },
    [handleCouponClick]
  );

  const handleDelete = useCallback(
    (name) => {
      const key = toItemKey(name);
      setItems((prev) => prev.filter((item) => toItemKey(item?.name) !== key));

      if (activeItemKey && activeItemKey === key) {
        setActiveItemKey("");
        setSelectedProductName("");
        setReportTypeOptions([]);
        setSelectedReportType("");
        setLotOptions([]);
        setSelectedLotId("");
      }
    },
    [activeItemKey]
  );

  const handleActivateItem = useCallback(
    async (item) => {
      if (!item) return;
      try {
        await syncProductMeta(item);
      } catch {
        // keep current UI state if metadata fetch fails
      }
    },
    [syncProductMeta]
  );

  const handleReportTypeChange = useCallback(
    (event) => {
      const value = toCleanText(event.target.value).toUpperCase();
      setSelectedReportType(value);
      if (!activeItemKey) return;

      setItems((prev) =>
        prev.map((item) =>
          toItemKey(item?.name) === activeItemKey
            ? { ...item, reportType: value }
            : item
        )
      );
    },
    [activeItemKey]
  );

  const handleLotSelectionChange = useCallback(
    (event) => {
      const lotId = toCleanText(event.target.value);
      setSelectedLotId(lotId);
      if (!activeItemKey) return;

      const matchedLot =
        lotOptions.find((option) => toCleanText(option.lotId) === lotId) || null;
      const lotNo = toCleanText(matchedLot?.lotNo);
      const lotExpDate = toCleanText(matchedLot?.expDate);

      setItems((prev) =>
        prev.map((item) =>
          toItemKey(item?.name) === activeItemKey
            ? { ...item, lotNo, lotId, lotExpDate }
            : item
        )
      );
    },
    [activeItemKey, lotOptions]
  );

  const buildDispensePayload = useCallback(() => {
    if (!items.length) {
      return {
        payload: null,
        error: "ยังไม่มีรายการสินค้าที่จะส่งมอบ",
      };
    }

    const lines = [];
    const validationErrors = [];

    items.forEach((item, index) => {
      const productId = toCleanText(item?.id);
      const qty = Number(item?.qty);
      const unitLabel = toCleanText(item?.unit);
      const rowLabel = `รายการที่ ${index + 1}`;

      if (!productId) {
        validationErrors.push(`${rowLabel} ไม่มี productId`);
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        validationErrors.push(`${rowLabel} จำนวนต้องมากกว่า 0`);
        return;
      }
      if (!unitLabel) {
        validationErrors.push(`${rowLabel} ไม่มีหน่วย (unitLabel)`);
        return;
      }

      const reportType = toCleanText(item?.reportType || selectedReportType).toUpperCase();

      lines.push({
        productId,
        qty,
        unitLabel,
        lotId: toCleanText(item?.lotId) || undefined,
        lotNo: toCleanText(item?.lotNo) || undefined,
        reportType: SUPPORTED_REPORT_TYPES.has(reportType) ? reportType : undefined,
        note: buildLineNote(item, reportType),
      });
    });

    if (validationErrors.length) {
      return {
        payload: null,
        error: validationErrors.join(" / "),
      };
    }

    const patient = parsedNotes?.patient || {};
    const reportType = toCleanText(selectedReportType).toUpperCase();
    const branchCode = isAdmin ? toCleanText(selectedBranchCode) : userBranchCode;

    if (isAdmin) {
      if (isLoadingBranches) {
        return {
          payload: null,
          error: "กำลังโหลดรายการสาขา กรุณารอสักครู่",
        };
      }

      if (!branchCode) {
        return {
          payload: null,
          error: "กรุณาเลือกสาขาที่ทำรายการก่อนยืนยันการส่งมอบยา",
        };
      }
    }

    return {
      payload: {
        branchCode,
        occurredAt: new Date().toISOString(),
        reportType: SUPPORTED_REPORT_TYPES.has(reportType) ? reportType : null,
        actionSource: "DELIVER_PAGE_FINAL",
        note: parsedNotes?.rawText || null,
        deliverNotesRaw: parsedNotes?.rawText || null,
        patient: {
          pid: toCleanText(patient?.pid) || null,
          fullName: toCleanText(patient?.fullName) || null,
          birthDate: patient?.birthDate || null,
          sex: patient?.sex || null,
          cardIssuePlace: toCleanText(patient?.cardIssuePlace) || null,
          cardIssuedDate: patient?.cardIssuedDate || null,
          cardExpiryDate: patient?.cardExpiryDate || null,
          addressText: toCleanText(patient?.addressText) || null,
        },
        lines,
      },
      error: "",
    };
  }, [
    isAdmin,
    isLoadingBranches,
    items,
    parsedNotes,
    selectedBranchCode,
    selectedReportType,
    userBranchCode,
  ]);

  const handleOpenConfirmModal = useCallback(() => {
    setSubmitSuccess("");
    const { error } = buildDispensePayload();
    if (error) {
      setSubmitError(error);
      return;
    }
    setSubmitError("");
    setIsModalOpen(true);
  }, [buildDispensePayload]);

  const handleConfirmDispense = useCallback(async () => {
    if (isSubmitting) return;

    const { payload, error } = buildDispensePayload();
    if (error || !payload) {
      setSubmitError(error || "ข้อมูลไม่ครบถ้วน");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      const response = await dispenseApi.create(payload);
      const lineCount = Number(response?.lineCount || payload.lines.length);
      const referenceId = toCleanText(response?.headerId);
      const successMessage = referenceId
        ? `บันทึกการส่งมอบสำเร็จ (${lineCount} รายการ) เลขอ้างอิง ${referenceId}`
        : `บันทึกการส่งมอบสำเร็จ (${lineCount} รายการ)`;

      setSubmitSuccess(successMessage);
      setIsModalOpen(false);
      setItems([]);
      setPendingMultiplier(null);
      setDeliverNotes("");
      deliverNotesRef.current = "";
      lastAutoFilledNotesRef.current = "";
      lastSmartcardFillRef.current = { signature: "", at: 0 };
      setReportTypeOptions([]);
      setSelectedReportType("");
      setLotOptions([]);
      setSelectedLotId("");
      setSelectedBranchCode(userBranchCode);
      setSelectedProductName("");
      setActiveItemKey("");
      if (barcodeInputRef.current) {
        barcodeInputRef.current.value = "";
        barcodeInputRef.current.focus();
      }
    } catch (error) {
      setSubmitError(error?.message || "บันทึกการส่งมอบไม่สำเร็จ");
    } finally {
      setIsSubmitting(false);
    }
  }, [buildDispensePayload, isSubmitting, userBranchCode]);

  const grandTotal = useMemo(() => {
    return items.reduce((sum, item) => sum + item.qty * item.price, 0);
  }, [items]);

  const selectedBranchLabel = useMemo(() => {
    const effectiveBranchCode = isAdmin ? selectedBranchCode : userBranchCode;
    if (!effectiveBranchCode) {
      return isAdmin ? "-" : "ตามสิทธิ์ผู้ใช้";
    }

    const matchedBranch = branchOptions.find((branch) => branch.code === effectiveBranchCode);
    if (matchedBranch) {
      return `${matchedBranch.code}${matchedBranch.name ? ` : ${matchedBranch.name}` : ""}`;
    }

    return effectiveBranchCode;
  }, [branchOptions, isAdmin, selectedBranchCode, userBranchCode]);

  const handleModalBackdrop = useCallback(
    (event) => {
      if (isSubmitting) return;
      if (event.target === event.currentTarget) {
        setIsModalOpen(false);
      }
    },
    [isSubmitting]
  );

  const canConfirm = items.length > 0 && !isSubmitting;

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
              ยังกรอกแบบสอบถามไม่ครบ -
              <button id="resumeFormBtn" type="button">
                ไปทำแบบสอบถามต่อ
              </button>
            </div>

            {submitError ? (
              <div className="pos-feedback pos-feedback--error">{submitError}</div>
            ) : null}
            {submitSuccess ? (
              <div className="pos-feedback pos-feedback--success">{submitSuccess}</div>
            ) : null}

            <div className="pos-panel">
              <div className="pos-left">
                <div className="pos-table">
                  <div className="thead">
                    <div>ลำดับที่</div>
                    <div className="thead-barcode">บาร์โค้ด</div>
                    <div className="thead-product-name">รายการสินค้า</div>
                    <div className="hide-md">รหัสสินค้า</div>
                    <div className="amount">จำนวน</div>
                    <div className="note-bin">NOTE</div>
                  </div>
                  <div className="tbody" id="items">
                    {items.map((item, index) => (
                      <div
                        key={`${item.name}-${item.barcode}-${index}`}
                        data-name={item.name}
                        className={
                          toItemKey(item?.name) === activeItemKey
                            ? "pos-item-row is-active"
                            : "pos-item-row"
                        }
                        onClick={() => {
                          void handleActivateItem(item);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void handleActivateItem(item);
                          }
                        }}
                      >
                        <div className="item-index">{index + 1}</div>
                        <div className="item-barcode">{item.barcode}</div>
                        <div className="item-name">{item.name}</div>
                        <div className="item-company">{item.companyCode}</div>
                        <div className="item-qty">{item.qty}</div>
                        <div className="item-note">
                          <button
                            className="item-delete"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDelete(item.name);
                            }}
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

                <div className="pos-bottomstack">
                  <div className="pos-inputbar">
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input
                        ref={barcodeInputRef}
                        id="barcode-input-field"
                        type="text"
                        placeholder="พิมพ์จำนวน -> กด 'คูณ (*)' หรือ PageDown -> สแกน/พิมพ์บาร์โค้ด แล้วกด Enter"
                        autoComplete="off"
                        onKeyDown={handleBarcodeKeyDown}
                      />
                      <span
                        className={`mult${pendingMultiplier ? " is-active" : ""}`}
                        id="multChip"
                        aria-live="polite"
                      >
                        {pendingMultiplier ? `x${pendingMultiplier}` : ""}
                      </span>
                    </div>
                    <div className="total">
                      <span id="grand">{toMoney(grandTotal)}</span> บาท
                    </div>
                  </div>

                  <div className="pos-notes-block">
                    <div className="pos-notes-grid">
                      <div className="pos-notes-column">
                        <label className="pos-notes-label" htmlFor="deliver-notes">
                          ลูกค้าที่รับมอบยา
                        </label>
                        <textarea
                          id="deliver-notes"
                          className="pos-notes-textarea"
                          placeholder="หมายเหตุ (กด Enter เพื่อขึ้นบรรทัดใหม่ได้)"
                          rows={4}
                          value={deliverNotes}
                          onChange={(event) => setDeliverNotes(event.target.value)}
                        />
                        <div
                          className={`pos-notes-help pos-notes-help--smartcard${
                            smartcardStatus.tone === "error"
                              ? " pos-notes-help--error"
                              : smartcardStatus.tone === "warn"
                              ? " pos-notes-help--warn"
                              : smartcardStatus.tone === "success"
                              ? " pos-notes-help--success"
                              : ""
                          }`}
                        >
                          {smartcardStatus.message}
                        </div>
                      </div>

                      <div className="pos-notes-column pos-notes-column--meta">
                        <div className="pos-notes-active-product">
                          สินค้าที่กำลังกำหนด lot/report: {selectedProductName || "-"}
                        </div>
                        <div className="pos-notes-field">
                          <label className="pos-notes-label" htmlFor="deliver-report-type">
                            ประเภทรายงาน
                          </label>
                          <select
                            id="deliver-report-type"
                            className="pos-notes-select"
                            value={selectedReportType}
                            onChange={handleReportTypeChange}
                          >
                            <option value="">
                              {selectedProductName
                                ? "ไม่พบประเภทรายงาน (KY10/KY11) สำหรับสินค้านี้"
                                : "สแกนสินค้าเพื่อดึงประเภทรายงานอัตโนมัติ"}
                            </option>
                            {reportTypeOptions.map((option) => (
                              <option key={option.code} value={option.code}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="pos-notes-field">
                          <label className="pos-notes-label" htmlFor="deliver-lot-number">
                            เลข lot number
                          </label>
                          <select
                            id="deliver-lot-number"
                            className="pos-notes-select"
                            value={selectedLotId}
                            onChange={handleLotSelectionChange}
                          >
                            <option value="">
                              {selectedProductName
                                ? "ไม่พบ lot ที่เคยรับเข้า/คงเหลือสำหรับสินค้านี้"
                                : "สแกนสินค้าเพื่อดึงเลข lot อัตโนมัติ"}
                            </option>
                            {lotOptions.map((option) => {
                              const optionLotId = toCleanText(option?.lotId);
                              if (!optionLotId) return null;
                              const expLabel = toDateLabel(option?.expDate);
                              const lotLabel = toCleanText(option?.lotNo) || optionLotId;
                              return (
                                <option
                                  key={optionLotId}
                                  value={optionLotId}
                                >
                                  {expLabel ? `${lotLabel} (exp ${expLabel})` : lotLabel}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <aside className="pos-rail">
                <div
                  className="coupon"
                  id="couponBox"
                  role="button"
                  tabIndex={0}
                  onClick={handleCouponClick}
                  onKeyDown={handleCouponKeyDown}
                >
                  คูณ ( * )<br />
                  <small>PAGE DOWN</small>
                </div>

                <button
                  className="btn btn-primary"
                  id="pos-confirmBtn"
                  type="button"
                  onClick={handleOpenConfirmModal}
                  disabled={!canConfirm}
                  title={items.length ? "" : "ยังไม่มีรายการสินค้า"}
                >
                  {isSubmitting ? "กำลังบันทึก..." : "ยืนยันการทำรายการ"}
                </button>

                <div className="pos-rail-field">
                  <label className="pos-notes-label" htmlFor="deliver-branch-code">
                    สาขาที่ทำรายการ
                  </label>
                  {isAdmin ? (
                    <select
                      id="deliver-branch-code"
                      className="pos-notes-select"
                      value={selectedBranchCode}
                      onChange={(event) => setSelectedBranchCode(toCleanText(event.target.value))}
                      disabled={isLoadingBranches}
                    >
                      <option value="">
                        {isLoadingBranches ? "กำลังโหลดรายการสาขา..." : "เลือกสาขาที่ทำรายการ"}
                      </option>
                      {branchOptions.map((branch) => (
                        <option key={branch.id || branch.code} value={branch.code}>
                          {branch.code}
                          {branch.name ? ` : ${branch.name}` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="pos-notes-readonly">{selectedBranchLabel}</div>
                  )}
                  {branchLoadError ? (
                    <div className="pos-notes-help pos-notes-help--error">{branchLoadError}</div>
                  ) : null}
                  {!isAdmin ? (
                    <div className="pos-notes-help">ระบบใช้สาขาตามสิทธิ์ผู้ใช้โดยอัตโนมัติ</div>
                  ) : null}
                </div>
              </aside>
            </div>
          </div>
        </section>
      </div>

      {isModalOpen ? (
        <div
          id="posMyModal"
          className="pos-modal"
          aria-hidden="false"
          onClick={handleModalBackdrop}
        >
          <div className="pos-confirm-dialog" role="dialog" aria-modal="true">
            <h2 className="pos-confirm-title">ยืนยันการทำรายการส่งมอบยา</h2>
            <p className="pos-confirm-body">
              เมื่อยืนยันแล้ว ระบบจะบันทึกการจ่ายยาและตัดสต็อกทันทีแบบถาวร ต้องการดำเนินการต่อหรือไม่
            </p>

            <div className="pos-confirm-summary">
              <div>จำนวนรายการยา: {items.length} รายการ</div>
              <div>ยอดรวม: {toMoney(grandTotal)} บาท</div>
              <div>สาขาที่ทำรายการ: {selectedBranchLabel}</div>
              <div>ประเภทรายงาน: {selectedReportType || "-"}</div>
              <div>
                ผู้รับมอบยา: {toCleanText(parsedNotes?.patient?.fullName) || "-"}
              </div>
            </div>

            <div className="pos-confirm-actions">
              <button
                type="button"
                className="btn pos-confirm-cancel"
                onClick={() => setIsModalOpen(false)}
                disabled={isSubmitting}
              >
                ปิด
              </button>
              <button
                type="button"
                className="btn btn-primary pos-confirm-submit"
                onClick={() => {
                  void handleConfirmDispense();
                }}
                disabled={isSubmitting}
              >
                {isSubmitting ? "กำลังยืนยัน..." : "ยืนยัน"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
