import { getApiBase } from "../api-base.js";

const API_BASE = getApiBase();
const CACHE_DB = "rx1011-pos-cache";
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const cart = new Map();
const cartOrder = [];

function openCacheDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);

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
  return (Array.isArray(data) ? data : [])
    .map(normalizeProduct)
    .filter(Boolean);
}

async function fetchVersion() {
  const res = await fetch(`${API_BASE}/api/products/version`);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.version || null;
}

async function syncSnapshot(options = {}) {
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

async function productLookup(barcode) {
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

document.addEventListener("includes:done", () => {
  const numberInput = document.getElementById("barcode-input-field");
  const itemsBody = document.getElementById("items");
  const grandTotal = document.getElementById("grand");
  const syncBtn = document.getElementById("pos-sync-btn");
  if (!numberInput) {
    console.error("barcode-input-field not found");
    return;
  }
  if (!itemsBody) {
    console.error("items not found");
    return;
  }

  const toMoney = (value) => Number(value || 0).toFixed(2);

  function renderRow(item, index) {
    const row = document.createElement("div");
    row.dataset.name = item.name;
    row.innerHTML = `
      <div class="item-index">${index}</div>
      <div class="item-barcode">${item.barcode}</div>
      <div class="item-name">${item.name}</div>
      <div class="item-company">${item.companyCode}</div>
      <div class="item-price">${toMoney(item.price)}</div>
      <div class="item-qty">${item.qty}</div>
      <div class="item-sum">${toMoney(item.qty * item.price)}</div>
      <div class="item-note">
        <button class="item-delete" type="button" data-name="${item.name}" aria-label="Delete item">
          <svg class="icon-trash" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM7 9h2v9H7V9Zm-1 12h12a2 2 0 0 0 2-2V8H4v11a2 2 0 0 0 2 2Z"></path>
          </svg>
        </button>
      </div>
    `;
    return row;
  }

  function updateRow(row, item) {
    const qtyEl = row.querySelector(".item-qty");
    const sumEl = row.querySelector(".item-sum");
    if (qtyEl) qtyEl.textContent = item.qty;
    if (sumEl) sumEl.textContent = toMoney(item.qty * item.price);
  }

  function updateGrandTotal() {
    if (!grandTotal) return;
    let sum = 0;
    cart.forEach((item) => {
      sum += item.qty * item.price;
    });
    grandTotal.textContent = toMoney(sum);
  }

  function refreshRowNumbers() {
    const rows = itemsBody.querySelectorAll("div[data-name]");
    rows.forEach((row, idx) => {
      const indexEl = row.querySelector(".item-index");
      if (indexEl) indexEl.textContent = idx + 1;
    });
  }

  function addToCart(product) {
    const key = product.name.trim();
    const existing = cart.get(key);
    if (existing) {
      existing.qty += 1;
      const row = itemsBody.querySelector(`[data-name="${CSS.escape(key)}"]`);
      if (row) updateRow(row, existing);
    } else {
      const item = { ...product, qty: 1 };
      cart.set(key, item);
      cartOrder.push(key);
      const row = renderRow(item, cartOrder.length);
      itemsBody.appendChild(row);
    }
    updateGrandTotal();
  }

  itemsBody.addEventListener("click", (event) => {
    const deleteBtn = event.target.closest(".item-delete");
    if (!deleteBtn) return;
    const name = deleteBtn.dataset.name;
    if (!name) return;

    cart.delete(name);
    const index = cartOrder.indexOf(name);
    if (index >= 0) cartOrder.splice(index, 1);

    const row = itemsBody.querySelector(`[data-name="${CSS.escape(name)}"]`);
    if (row) row.remove();

    refreshRowNumbers();
    updateGrandTotal();
  });

  numberInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    const inputBarcode = numberInput.value;
    const showProduct = await productLookup(inputBarcode);
    if (showProduct) addToCart(showProduct);
    else console.warn("ไม่พบสินค้า/ออฟไลน์");
    numberInput.value = "";
  });

  syncSnapshot().catch(() => {});

  if (syncBtn) {
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      try {
        await syncSnapshot({ force: true });
      } catch (err) {
        console.error("Sync failed", err);
      } finally {
        syncBtn.disabled = false;
      }
    });
  }
});


// ==============================================
// กำหนด เลข multiplier ไปใส่ในช่อง multchip
// ==============================================1


