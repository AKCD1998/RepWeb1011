import { getApiBase } from "./deliverApiBase";
import { authApiClient } from "../lib/authApi";

const API_BASE = getApiBase();
const CACHE_DB = "rx1011-pos-cache";
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function openCacheDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, CACHE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("products")) {
        db.createObjectStore("products", { keyPath: "barcode" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(storeName, key) {
  const db = await openCacheDb();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  const db = await openCacheDb();
  if (!db) return false;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbBulkPut(storeName, values) {
  const db = await openCacheDb();
  if (!db) return false;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    values.forEach((value) => store.put(value));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function lsPut(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function normalizeBarcode(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  return trimmed.slice(-13);
}

function normalizeReportGroupCodes(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Set();
  value.forEach((entry) => {
    const code = String(entry || "").trim().toUpperCase();
    if (code) unique.add(code);
  });
  return [...unique];
}

function normalizeProduct(data) {
  if (!data) return null;
  const barcode = String(data.barcode || "").trim();
  if (!barcode) return null;
  const companyCode = String(
    data.companyCode ?? data.productCode ?? data.product_code ?? data.company_code ?? ""
  ).trim();

  return {
    id: data.id ?? data.productId ?? data.product_id ?? "",
    barcode,
    companyCode,
    productCode: companyCode,
    name: data.name ?? data.brand_name ?? data.product_name ?? "",
    price: Number(data.price ?? data.price_baht ?? 0),
    qtyPerUnit: Number(data.qtyPerUnit ?? data.qty_per_unit ?? 1),
    unit: data.unit ?? "",
    reportGroupCodes: normalizeReportGroupCodes(data.reportGroupCodes ?? data.report_group_codes),
  };
}

async function getCachedProduct(barcode) {
  const cached = await idbGet("products", barcode);
  if (cached) return cached;

  const ls = lsGet(`pos_product_${barcode}`);
  return ls || null;
}

async function setCachedProduct(product) {
  if (!product || !product.barcode) return false;
  const stored = await idbPut("products", product);
  if (stored) return true;
  return lsPut(`pos_product_${product.barcode}`, product);
}

async function getCacheMeta() {
  const meta = await idbGet("meta", "products-meta");
  if (meta) return meta;
  return lsGet("pos_products_meta");
}

async function setCacheMeta(meta) {
  if (!meta) return false;
  const stored = await idbPut("meta", meta);
  if (stored) return true;
  return lsPut("pos_products_meta", meta);
}

async function fetchProductFromServer(barcode) {
  const res = await fetch(
    `${API_BASE}/api/products?barcode=${encodeURIComponent(barcode)}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return normalizeProduct(data);
}

async function fetchProductsBySearch(search) {
  const term = String(search || "").trim();
  if (!term) return [];
  const res = await fetch(`${API_BASE}/api/products?search=${encodeURIComponent(term)}`);
  if (!res.ok) return [];
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) =>
      normalizeProduct({
        id: row?.id,
        barcode: row?.barcode,
        productCode: row?.productCode ?? row?.product_code,
        name: row?.tradeName ?? row?.productName,
        price: row?.price,
        unit: row?.unitSymbol ?? row?.unit,
        reportGroupCodes: row?.reportGroupCodes ?? row?.report_group_codes,
      })
    )
    .filter(Boolean);
}

function pickMatchedProductCandidate(candidates, seedProduct) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const seedBarcode = String(seedProduct?.barcode || "").trim();
  const seedProductCode = String(
    seedProduct?.productCode ?? seedProduct?.companyCode ?? ""
  ).trim();

  return (
    candidates.find((item) => String(item?.barcode || "").trim() === seedBarcode) ||
    candidates.find((item) => String(item?.productCode || "").trim() === seedProductCode) ||
    candidates[0]
  );
}

async function fetchSnapshot() {
  const res = await fetch(`${API_BASE}/api/products/snapshot`);
  if (!res.ok) throw new Error("snapshot failed");
  const data = await res.json();
  return (Array.isArray(data) ? data : []).map(normalizeProduct).filter(Boolean);
}

async function fetchVersion() {
  const res = await fetch(`${API_BASE}/api/products/version`);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.version || null;
}

export async function syncSnapshot(options = {}) {
  const force = options.force === true;
  const meta = await getCacheMeta();
  const now = Date.now();
  const stale = !meta?.lastSync || now - meta.lastSync > CACHE_TTL_MS;

  let remoteVersion = null;
  try {
    remoteVersion = await fetchVersion();
  } catch {
    remoteVersion = null;
  }

  if (!force && !stale && remoteVersion && meta?.version === remoteVersion) {
    return { updated: false };
  }

  const snapshot = await fetchSnapshot();
  if (snapshot.length) {
    await idbBulkPut("products", snapshot);
  }
  await setCacheMeta({
    key: "products-meta",
    lastSync: now,
    version: remoteVersion || meta?.version || "unknown",
  });

  return { updated: true, count: snapshot.length };
}

export async function productLookup(barcode) {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) return null;

  const cached = await getCachedProduct(normalized);
  if (cached) {
    const hasMetadata =
      String(cached.id || "").trim() && Array.isArray(cached.reportGroupCodes);
    if (!hasMetadata) {
      try {
        const fresh = await fetchProductFromServer(normalized);
        if (fresh) {
          await setCachedProduct(fresh);
          return fresh;
        }
      } catch {
        // fallback to cached
      }
    }

    fetchProductFromServer(normalized)
      .then((fresh) => {
        if (fresh) setCachedProduct(fresh);
      })
      .catch(() => {});
    return cached;
  }

  try {
    const fresh = await fetchProductFromServer(normalized);
    if (fresh) {
      await setCachedProduct(fresh);
      return fresh;
    }
  } catch {
    return null;
  }

  return null;
}

export async function hydrateProductMetadata(seedProduct) {
  const normalizedSeed = normalizeProduct(seedProduct);
  if (!normalizedSeed) return null;

  const hasId = String(normalizedSeed.id || "").trim();
  const hasReportCodes = Array.isArray(normalizedSeed.reportGroupCodes);
  if (hasId && hasReportCodes) return normalizedSeed;

  const probes = [
    normalizedSeed.productCode || normalizedSeed.companyCode,
    normalizedSeed.barcode,
    normalizedSeed.name,
  ]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  const uniqueProbes = [...new Set(probes)];
  for (const probe of uniqueProbes) {
    try {
      const candidates = await fetchProductsBySearch(probe);
      const matched = pickMatchedProductCandidate(candidates, normalizedSeed);
      if (!matched) continue;
      const merged = {
        ...normalizedSeed,
        ...matched,
        reportGroupCodes: normalizeReportGroupCodes(
          matched.reportGroupCodes?.length ? matched.reportGroupCodes : normalizedSeed.reportGroupCodes
        ),
      };
      await setCachedProduct(merged);
      return merged;
    } catch {
      // try next probe
    }
  }

  return normalizedSeed;
}

export async function fetchProductLots(filters = {}) {
  const safeProductId = String(filters?.productId || "").trim();
  const safeProductCode = String(filters?.productCode || "").trim();
  const safeBranchCode = String(filters?.branchCode || "").trim();
  if (!safeProductId && !safeProductCode) return [];

  const params = {};
  if (safeProductId) {
    params.productId = safeProductId;
  }
  if (safeBranchCode) {
    params.branchCode = safeBranchCode;
  }

  const response = await authApiClient.get("/api/stock/on-hand", {
    params: Object.keys(params).length ? params : undefined,
  });
  const list = Array.isArray(response?.data) ? response.data : [];
  const seen = new Set();
  const lots = [];

  list.forEach((row) => {
    const rowProductId = String(row?.productId ?? row?.product_id ?? "").trim();
    const rowProductCode = String(row?.productCode ?? row?.product_code ?? "").trim();
    if (safeProductId) {
      if (rowProductId && rowProductId !== safeProductId) return;
    } else if (safeProductCode && rowProductCode !== safeProductCode) {
      return;
    }

    const lotNo = String(row?.lotNo ?? row?.lot_no ?? "").trim();
    if (!lotNo) return;

    const expDate = String(row?.expDate ?? row?.exp_date ?? "").trim();
    const lotId = String(row?.lotId ?? row?.lot_id ?? "").trim();
    const key = `${lotNo}|${expDate}`;
    if (seen.has(key)) return;
    seen.add(key);
    lots.push({
      lotId,
      lotNo,
      expDate,
    });
  });

  lots.sort((a, b) => {
    const expA = a.expDate || "9999-12-31";
    const expB = b.expDate || "9999-12-31";
    if (expA !== expB) return expA.localeCompare(expB);
    return a.lotNo.localeCompare(b.lotNo);
  });

  return lots;
}
