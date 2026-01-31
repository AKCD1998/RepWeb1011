import { getApiBase } from "./deliverApiBase";

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

function normalizeProduct(data) {
  if (!data) return null;
  const barcode = String(data.barcode || "").trim();
  if (!barcode) return null;

  return {
    barcode,
    companyCode: data.companyCode ?? data.product_code ?? data.company_code ?? "",
    name: data.name ?? data.brand_name ?? data.product_name ?? "",
    price: Number(data.price ?? data.price_baht ?? 0),
    qtyPerUnit: Number(data.qtyPerUnit ?? data.qty_per_unit ?? 1),
    unit: data.unit ?? "",
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
