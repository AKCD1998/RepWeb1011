import { useEffect, useMemo, useState } from "react";
import { DEFAULT_MAKER } from "../data/report1011Products";
import { productsApi } from "../lib/api";
import { parseProductLine } from "../lib/report1011/utils";

function normalizeProductOption(product) {
  const tradeName = String(product?.tradeName || "").trim();
  if (!tradeName) return null;

  const packageSize = String(product?.packageSize || product?.packagingSummary || "").trim();
  const maker = String(product?.manufacturerName || "").trim();
  const reportGroupCodes = Array.isArray(product?.reportGroupCodes)
    ? product.reportGroupCodes
        .map((code) => String(code || "").trim().toUpperCase())
        .filter(Boolean)
    : [];

  return {
    id: String(product?.id || "").trim(),
    value: packageSize ? `${tradeName} : ${packageSize}` : tradeName,
    maker,
    reportGroupCodes,
  };
}

function resolveReportGroupCode(reportType) {
  const normalized = String(reportType || "").trim().toUpperCase();
  if (!normalized) return "";
  if (normalized.startsWith("R10_")) return "KY10";
  if (normalized.startsWith("R11_")) return "KY11";
  return normalized;
}

export function useReport1011Products({ reportType, productName }) {
  const [products, setProducts] = useState([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productsError, setProductsError] = useState("");

  useEffect(() => {
    let cancelled = false;

    setIsLoadingProducts(true);
    setProductsError("");

    productsApi
      .list("")
      .then((rows) => {
        if (cancelled) return;
        setProducts(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        if (cancelled) return;
        setProducts([]);
        setProductsError(error?.message || "โหลดรายการสินค้าไม่สำเร็จ");
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingProducts(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const productOptions = useMemo(() => {
    const normalizedReportGroupCode = resolveReportGroupCode(reportType);
    if (!normalizedReportGroupCode) return [];

    const uniqueOptions = new Map();
    for (const product of products) {
      const option = normalizeProductOption(product);
      if (!option || !option.reportGroupCodes.includes(normalizedReportGroupCode)) {
        continue;
      }
      if (!uniqueOptions.has(option.value)) {
        uniqueOptions.set(option.value, option);
      }
    }

    return [...uniqueOptions.values()].sort((left, right) =>
      left.value.localeCompare(right.value, "th")
    );
  }, [products, reportType]);

  const inferredMaker = useMemo(() => {
    if (!productName) return "";
    const selectedProduct = productOptions.find((option) => option.value === productName);
    return selectedProduct?.maker || DEFAULT_MAKER;
  }, [productName, productOptions]);

  const parsedProduct = useMemo(() => {
    if (!productName) return { name: "", packSize: "" };
    const parsed = parseProductLine(productName);
    return { name: parsed.name, packSize: parsed.pack };
  }, [productName]);

  return {
    productOptions: productOptions.map((option) => option.value),
    inferredMaker,
    parsedProduct,
    isLoadingProducts,
    productsError,
  };
}
