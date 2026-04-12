const DB_NAME = "rx1011-pending-dispense-queue";
const DB_VERSION = 1;
const STORE_NAME = "pendingDispenses";

function canUseIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function openPendingDb() {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "localTxnId" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, work) {
  const db = await openPendingDb();
  if (!db) {
    throw new Error("IndexedDB is not available for pending dispense queue");
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let workResult;

    try {
      workResult = work(store);
    } catch (error) {
      reject(error);
      return;
    }

    tx.oncomplete = () => resolve(workResult);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function buildLocalTxnId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const randomSource =
    typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"
      ? crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
      : Math.random().toString(36).slice(2, 10);
  return `OFF-${timestamp}-${randomSource.slice(0, 8).toUpperCase()}`;
}

function normalizePendingRecord(record = {}) {
  const now = new Date().toISOString();
  const localTxnId = String(record.localTxnId || "").trim() || buildLocalTxnId();

  return {
    ...record,
    localTxnId,
    status: String(record.status || "PENDING").trim().toUpperCase(),
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
}

export async function savePendingDispense(record) {
  const normalized = normalizePendingRecord(record);
  await withStore("readwrite", (store) => {
    store.put(normalized);
  });
  return normalized;
}

export async function updatePendingDispense(localTxnId, patch = {}) {
  const key = String(localTxnId || "").trim();
  if (!key) throw new Error("localTxnId is required");

  const existing = await getPendingDispense(key);
  if (!existing) {
    throw new Error(`Pending dispense not found: ${key}`);
  }

  const nextRecord = normalizePendingRecord({
    ...existing,
    ...patch,
    localTxnId: key,
    createdAt: existing.createdAt,
  });

  await withStore("readwrite", (store) => {
    store.put(nextRecord);
  });
  return nextRecord;
}

export async function getPendingDispense(localTxnId) {
  const key = String(localTxnId || "").trim();
  if (!key) return null;

  return withStore("readonly", (store) => {
    const request = store.get(key);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  });
}

export async function listPendingDispenses() {
  const rows = await withStore("readonly", (store) => {
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error);
    });
  });

  return rows
    .filter((row) => String(row?.status || "PENDING").toUpperCase() === "PENDING")
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
}

export async function removePendingDispense(localTxnId) {
  const key = String(localTxnId || "").trim();
  if (!key) return false;

  await withStore("readwrite", (store) => {
    store.delete(key);
  });
  return true;
}

