import { getApiBase } from "./deliverApiBase";
import { authApiClient } from "../lib/authApi";

const API_BASE = getApiBase();
const CACHE_DB = "rx1011-pos-cache";
const CACHE_VERSION = 2;
export const DELIVERY_METADATA_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PRODUCT_CACHE_TTL_MS = DELIVERY_METADATA_CACHE_TTL_MS;
const LOT_CACHE_TTL_MS = DELIVERY_METADATA_CACHE_TTL_MS;
const PRODUCT_STORE = "products";
const META_STORE = "meta";
const LOT_STORE = "productLots";

function openCacheDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, CACHE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
        db.createObjectStore(PRODUCT_STORE, { keyPath: "barcode" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(LOT_STORE)) {
        const store = db.createObjectStore(LOT_STORE, { keyPath: "cacheKey" });
        store.createIndex("branchCode", "branchCode", { unique: false });
        store.createIndex("cachedAt", "cachedAt", { unique: false });
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

async function idbGetAll(storeName) {
  const db = await openCacheDb();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
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

function isBrowserOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

function normalizeBarcode(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  return trimmed.slice(-13);
}

function normalizeProductCode(input) {
  return String(input || "").trim().toUpperCase();
}

function toProductIdentityKey(productId, productCode) {
  const safeProductId = String(productId || "").trim();
  if (safeProductId) return `id:${safeProductId}`;

  const safeProductCode = String(productCode || "").trim();
  if (safeProductCode) return `code:${safeProductCode}`;

  return "";
}

export function buildProductLotCacheKey(filters = {}) {
  const productKey = toProductIdentityKey(filters?.productId, filters?.productCode);
  if (!productKey) return "";
  const safeBranchCode = String(filters?.branchCode || "").trim() || "*";
  return `${safeBranchCode}|${productKey}`;
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
  const companyCode = String(
    data.companyCode ?? data.productCode ?? data.product_code ?? data.company_code ?? ""
  ).trim();
  const barcode = String(data.barcode || "").trim() || companyCode;
  if (!barcode && !companyCode) return null;

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

function normalizeLotRows(rows = []) {
  const seen = new Set();
  const lots = [];

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const lotNo = String(row?.lotNo ?? row?.lot_no ?? "").trim();
    if (!lotNo) return;

    const expDate = String(row?.expDate ?? row?.exp_date ?? "").trim();
    const lotId = String(row?.lotId ?? row?.lot_id ?? "").trim();
    const key = lotId || `${lotNo}|${expDate}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    lots.push({
      lotId,
      lotNo,
      expDate,
      quantityBase:
        row?.quantityBase === null || row?.quantityBase === undefined
          ? undefined
          : Number(row.quantityBase),
      unitLabel: String(row?.unitLabel ?? row?.unit_label ?? "").trim() || undefined,
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

function normalizeLotCacheRecord(record = {}) {
  const cacheKey = String(record?.cacheKey || "").trim();
  if (!cacheKey) return null;

  return {
    cacheKey,
    productId: String(record?.productId || "").trim(),
    productCode: String(record?.productCode || "").trim(),
    branchCode: String(record?.branchCode || "").trim(),
    cachedAt: Number(record?.cachedAt || Date.now()),
    sourceVersion: String(record?.sourceVersion || "").trim() || null,
    lots: normalizeLotRows(record?.lots),
  };
}

async function getCachedProduct(barcode) {
  const cached = await idbGet(PRODUCT_STORE, barcode);
  if (cached) return cached;

  const ls = lsGet(`pos_product_${barcode}`);
  return ls || null;
}

function isProductCodeMatch(product, productCode) {
  const normalized = normalizeProductCode(productCode);
  if (!normalized) return false;
  return (
    normalizeProductCode(product?.productCode) === normalized ||
    normalizeProductCode(product?.companyCode) === normalized
  );
}

async function getCachedProductByProductCode(productCode) {
  const normalized = normalizeProductCode(productCode);
  if (!normalized) return null;

  const cachedRows = await idbGetAll(PRODUCT_STORE);
  const idbMatch = cachedRows.find((product) => isProductCodeMatch(product, normalized));
  if (idbMatch) return idbMatch;

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith("pos_product_")) continue;
      const product = lsGet(key);
      if (isProductCodeMatch(product, normalized)) return product;
    }
  } catch {
    return null;
  }

  return null;
}

async function setCachedProduct(product) {
  if (!product || !product.barcode) return false;
  const stored = await idbPut(PRODUCT_STORE, {
    ...product,
    cachedAt: Date.now(),
  });
  if (stored) return true;
  return lsPut(`pos_product_${product.barcode}`, {
    ...product,
    cachedAt: Date.now(),
  });
}

async function getCacheMeta() {
  const meta = await idbGet(META_STORE, "products-meta");
  if (meta) return meta;
  return lsGet("pos_products_meta");
}

async function setCacheMeta(meta) {
  if (!meta) return false;
  const stored = await idbPut(META_STORE, meta);
  if (stored) return true;
  return lsPut("pos_products_meta", meta);
}

function lotLocalStorageKey(cacheKey) {
  return `pos_product_lots_${cacheKey}`;
}

async function getCachedLotRecord(cacheKey) {
  const key = String(cacheKey || "").trim();
  if (!key) return null;

  const cached = normalizeLotCacheRecord(await idbGet(LOT_STORE, key));
  if (cached) return cached;

  return normalizeLotCacheRecord(lsGet(lotLocalStorageKey(key)));
}

async function setCachedLotRecord(filters = {}, lots = [], sourceVersion = null) {
  const cacheKey = buildProductLotCacheKey(filters);
  if (!cacheKey) return false;

  const record = normalizeLotCacheRecord({
    cacheKey,
    productId: filters?.productId,
    productCode: filters?.productCode,
    branchCode: filters?.branchCode,
    cachedAt: Date.now(),
    sourceVersion,
    lots,
  });
  if (!record) return false;

  const stored = await idbPut(LOT_STORE, record);
  if (stored) return true;
  return lsPut(lotLocalStorageKey(cacheKey), record);
}

function toLotResult(record, source, maxAgeMs = LOT_CACHE_TTL_MS) {
  const cachedAt = Number(record?.cachedAt || 0);
  const ageMs = cachedAt ? Date.now() - cachedAt : Number.POSITIVE_INFINITY;
  return {
    cacheKey: String(record?.cacheKey || "").trim(),
    productId: String(record?.productId || "").trim(),
    productCode: String(record?.productCode || "").trim(),
    branchCode: String(record?.branchCode || "").trim(),
    lots: normalizeLotRows(record?.lots),
    source,
    cachedAt: cachedAt || null,
    ageMs,
    stale: ageMs > maxAgeMs,
  };
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

function pickExactLookupCandidate(candidates, input) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const normalizedInput = String(input || "").trim();
  const normalizedProductCode = normalizeProductCode(normalizedInput);

  return (
    candidates.find((item) => String(item?.barcode || "").trim() === normalizedInput) ||
    candidates.find((item) => isProductCodeMatch(item, normalizedProductCode)) ||
    null
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
  const stale = !meta?.lastSync || now - meta.lastSync > PRODUCT_CACHE_TTL_MS;

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
    const cachedAt = Date.now();
    await idbBulkPut(
      PRODUCT_STORE,
      snapshot.map((product) => ({ ...product, cachedAt }))
    );
  }
  await setCacheMeta({
    key: "products-meta",
    lastSync: now,
    version: remoteVersion || meta?.version || "unknown",
  });

  return { updated: true, count: snapshot.length };
}

async function lookupProductFromServer(rawInput, normalizedBarcode) {
  let lastError = null;

  try {
    const fresh = await fetchProductFromServer(normalizedBarcode);
    if (fresh) {
      await setCachedProduct(fresh);
      return fresh;
    }
  } catch (error) {
    lastError = error;
  }

  try {
    const candidates = await fetchProductsBySearch(rawInput);
    const matched = pickExactLookupCandidate(candidates, rawInput);
    if (matched) {
      await setCachedProduct(matched);
      return matched;
    }
  } catch (error) {
    lastError = lastError || error;
  }

  if (lastError) throw lastError;
  return null;
}

export async function productLookup(input) {
  const rawInput = String(input || "").trim();
  const normalized = normalizeBarcode(rawInput);
  if (!normalized) return null;

  const preferServer = isBrowserOnline();
  if (preferServer) {
    try {
      const fresh = await lookupProductFromServer(rawInput, normalized);
      if (fresh) return fresh;
    } catch {
      // fallback to local cache below
    }
  }

  const cached = await getCachedProduct(normalized);
  if (cached) {
    const hasMetadata =
      String(cached.id || "").trim() && Array.isArray(cached.reportGroupCodes);
    if (!hasMetadata && !preferServer) {
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

    if (!preferServer) {
      fetchProductFromServer(normalized)
        .then((fresh) => {
          if (fresh) setCachedProduct(fresh);
        })
        .catch(() => {});
    }
    return cached;
  }

  const cachedByProductCode = await getCachedProductByProductCode(rawInput);
  if (cachedByProductCode) {
    return cachedByProductCode;
  }

  if (!preferServer) {
    try {
      const fresh = await lookupProductFromServer(rawInput, normalized);
      if (fresh) return fresh;
    } catch {
      return null;
    }
  }

  return null;
}

async function getCachedHydrationCandidate(seedProduct) {
  const barcode = String(seedProduct?.barcode || "").trim();
  if (barcode) {
    const cached = await getCachedProduct(barcode);
    if (cached) return cached;
  }

  const productCode = String(
    seedProduct?.productCode ?? seedProduct?.companyCode ?? ""
  ).trim();
  if (productCode) {
    return getCachedProductByProductCode(productCode);
  }

  return null;
}

export async function hydrateProductMetadata(seedProduct, options = {}) {
  const normalizedSeed = normalizeProduct(seedProduct);
  if (!normalizedSeed) return null;

  const hasId = String(normalizedSeed.id || "").trim();
  const hasReportCodes = Array.isArray(normalizedSeed.reportGroupCodes);
  const preferServer = options.preferServer ?? isBrowserOnline();
  if (hasId && hasReportCodes && !preferServer) return normalizedSeed;

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

  const cached = await getCachedHydrationCandidate(normalizedSeed);
  if (cached) {
    return {
      ...normalizedSeed,
      ...cached,
      reportGroupCodes: normalizeReportGroupCodes(
        cached.reportGroupCodes?.length ? cached.reportGroupCodes : normalizedSeed.reportGroupCodes
      ),
    };
  }

  return normalizedSeed;
}

async function fetchStockOnHandRows(filters = {}) {
  const params = {};
  const safeProductId = String(filters?.productId || "").trim();
  const safeBranchCode = String(filters?.branchCode || "").trim();

  if (safeProductId) {
    params.productId = safeProductId;
  }
  if (safeBranchCode) {
    params.branchCode = safeBranchCode;
  }

  const response = await authApiClient.get("/api/stock/on-hand", {
    params: Object.keys(params).length ? params : undefined,
  });

  return Array.isArray(response?.data) ? response.data : [];
}

async function fetchProductLotsFromServer(filters = {}) {
  const safeProductId = String(filters?.productId || "").trim();
  const safeProductCode = String(filters?.productCode || "").trim();
  const safeBranchCode = String(filters?.branchCode || "").trim();
  if (!safeProductId && !safeProductCode) return [];

  const list = await fetchStockOnHandRows({
    productId: safeProductId,
    branchCode: safeBranchCode,
  });

  return normalizeLotRows(
    list.filter((row) => {
    const rowProductId = String(row?.productId ?? row?.product_id ?? "").trim();
    const rowProductCode = String(row?.productCode ?? row?.product_code ?? "").trim();
    if (safeProductId) {
        return !rowProductId || rowProductId === safeProductId;
    }
      return safeProductCode ? rowProductCode === safeProductCode : true;
    })
  );
}

async function cacheLotRowsFromStockRows(rows = [], defaultBranchCode = "") {
  const groups = new Map();

  function addRowToGroup(filters, row) {
    const cacheKey = buildProductLotCacheKey(filters);
    if (!cacheKey) return;
    if (!groups.has(cacheKey)) {
      groups.set(cacheKey, {
        filters,
        rows: [],
      });
    }
    groups.get(cacheKey).rows.push(row);
  }

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const productId = String(row?.productId ?? row?.product_id ?? "").trim();
    const productCode = String(row?.productCode ?? row?.product_code ?? "").trim();
    const branchCode = String(row?.branchCode ?? row?.branch_code ?? defaultBranchCode).trim();
    if (!branchCode || (!productId && !productCode)) return;

    addRowToGroup({ productId, productCode, branchCode }, row);
    if (productId && productCode) {
      addRowToGroup({ productCode, branchCode }, row);
    }
  });

  for (const group of groups.values()) {
    await setCachedLotRecord(group.filters, normalizeLotRows(group.rows));
  }

  return groups.size;
}

export async function getProductLotsWithCache(filters = {}, options = {}) {
  const cacheKey = buildProductLotCacheKey(filters);
  if (!cacheKey) {
    return {
      cacheKey: "",
      lots: [],
      source: "missing-key",
      cachedAt: null,
      ageMs: Number.POSITIVE_INFINITY,
      stale: true,
    };
  }

  const maxAgeMs = Number(options?.maxAgeMs || LOT_CACHE_TTL_MS);
  const preferCache = options?.preferCache === true || !isBrowserOnline();
  const cached = await getCachedLotRecord(cacheKey);

  if (preferCache) {
    if (cached) return toLotResult(cached, "cache", maxAgeMs);
    return {
      cacheKey,
      lots: [],
      source: "missing-cache",
      cachedAt: null,
      ageMs: Number.POSITIVE_INFINITY,
      stale: true,
    };
  }

  try {
    const lots = await fetchProductLotsFromServer(filters);
    await setCachedLotRecord(filters, lots);
    return toLotResult(
      {
        cacheKey,
        productId: filters?.productId,
        productCode: filters?.productCode,
        branchCode: filters?.branchCode,
        cachedAt: Date.now(),
        lots,
      },
      "server",
      maxAgeMs
    );
  } catch (error) {
    if (cached) {
      return {
        ...toLotResult(cached, "cache", maxAgeMs),
        error: error?.message || "ไม่สามารถโหลด lot จาก backend ได้",
      };
    }

    return {
      cacheKey,
      lots: [],
      source: "error",
      cachedAt: null,
      ageMs: Number.POSITIVE_INFINITY,
      stale: true,
      error: error?.message || "ไม่สามารถโหลด lot จาก backend ได้",
    };
  }
}

export async function fetchProductLots(filters = {}, options = {}) {
  const result = await getProductLotsWithCache(filters, options);
  return result.lots;
}

export async function syncDeliverMetadataSnapshot(filters = {}, options = {}) {
  const result = {
    products: null,
    lots: null,
    errors: [],
  };

  try {
    result.products = await syncSnapshot(options);
  } catch (error) {
    result.errors.push(error);
  }

  const branchCode = String(filters?.branchCode || "").trim();
  if (branchCode) {
    try {
      const rows = await fetchStockOnHandRows({ branchCode });
      result.lots = {
        updated: true,
        count: rows.length,
        groups: await cacheLotRowsFromStockRows(rows, branchCode),
      };
    } catch (error) {
      result.errors.push(error);
    }
  }

  if (result.errors.length && !result.products && !result.lots) {
    throw result.errors[0];
  }

  return result;
}
