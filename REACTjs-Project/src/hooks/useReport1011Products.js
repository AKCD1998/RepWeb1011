import { useMemo } from "react";
import { DEFAULT_MAKER, PRODUCT_MAP, PRODUCT_MAKER } from "../data/report1011Products";
import { parseProductLine } from "../lib/report1011/utils";

export function useReport1011Products({ reportType, productName }) {
  const productOptions = useMemo(() => {
    return PRODUCT_MAP[reportType] || [];
  }, [reportType]);

  const inferredMaker = useMemo(() => {
    if (!productName) return "";
    const key = productName.split(":")[0].trim();
    return PRODUCT_MAKER[key] || DEFAULT_MAKER;
  }, [productName]);

  const parsedProduct = useMemo(() => {
    if (!productName) return { name: "", packSize: "" };
    const parsed = parseProductLine(productName);
    return { name: parsed.name, packSize: parsed.pack };
  }, [productName]);

  return { productOptions, inferredMaker, parsedProduct };
}
