import { authApiClient } from "./authApi";

async function requestJson(config) {
  const response = await authApiClient.request(config);
  if (response.status === 204) return null;
  return response.data;
}

function normalizeBangkokDateTimeInput(value) {
  const text = String(value ?? "").trim();
  if (!text) return value;
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text)) {
    return text;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(text)) {
    return `${text}+07:00`;
  }
  return text;
}

function buildStockOnHandParams(filters = {}) {
  const params = {};
  const branchCode = String(filters?.branchCode || "").trim();
  const productId = String(filters?.productId || "").trim();

  if (branchCode) {
    params.branchCode = branchCode;
  }
  if (productId) {
    params.productId = productId;
  }

  return Object.keys(params).length ? params : undefined;
}

function buildMovementWriteRequestPayload(payload = {}) {
  const movementType = String(payload.movementType || "").trim().toUpperCase();
  const productId = String(payload.productId || "").trim();
  const qty = Number(payload.qty);
  const unitLevelId = String(payload.unitLevelId ?? payload.unit_level_id ?? "").trim();
  const unitLabel = String(payload.unitLabel || payload.unit || "").trim();
  const fromLocationId = String(payload.from_location_id ?? payload.fromLocationId ?? "").trim();
  const toLocationId = String(payload.to_location_id ?? payload.toLocationId ?? "").trim();
  const lotId = String(payload.lotId ?? payload.lot_id ?? "").trim();
  const lotNo = String(payload.lotNo ?? payload.lot_no ?? "").trim();
  const expDate = String(payload.expDate ?? payload.exp_date ?? "").trim();
  const mfgDate = String(payload.mfgDate ?? payload.mfg_date ?? "").trim();
  const manufacturer = String(payload.manufacturer ?? payload.manufacturerName ?? "").trim();

  if (!movementType) {
    throw new Error("movementType is required");
  }
  if (!productId) {
    throw new Error("productId is required");
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("qty must be a positive number");
  }
  if (!unitLevelId && !unitLabel) {
    throw new Error("unitLevelId or unitLabel is required");
  }
  if (!lotId && !lotNo) {
    throw new Error("lotNo is required");
  }
  if (!lotId && !expDate) {
    throw new Error("expDate is required");
  }

  const occurredAt = normalizeBangkokDateTimeInput(payload.occurredAt);
  const note = String(payload.note || "").trim() || null;
  const requestPayload = {
    movementType,
    productId,
    qty,
    lotNo,
    expDate,
    occurredAt,
    note,
  };

  if (lotId) {
    requestPayload.lot_id = lotId;
  }
  if (unitLevelId) {
    requestPayload.unit_level_id = unitLevelId;
  }
  if (unitLabel) {
    requestPayload.unitLabel = unitLabel;
  }
  if (mfgDate) {
    requestPayload.mfgDate = mfgDate;
  }
  if (manufacturer) {
    requestPayload.manufacturer = manufacturer;
  }
  if (fromLocationId) {
    requestPayload.from_location_id = fromLocationId;
  }
  if (toLocationId) {
    requestPayload.to_location_id = toLocationId;
  }

  return requestPayload;
}

export const productsApi = {
  list(search = "") {
    const value = String(search || "").trim();
    return requestJson({
      method: "GET",
      url: "/api/products",
      params: value ? { search: value } : undefined,
    });
  },
  unitLevels(productId, options = {}) {
    const id = String(productId || "").trim();
    if (!id) {
      return Promise.resolve({ items: [] });
    }

    const params = {};
    const lotId = String(options?.lotId || options?.lot_id || "").trim();
    const lotNo = String(options?.lotNo || options?.lot_no || "").trim();
    const expDate = String(options?.expDate || options?.exp_date || "").trim();

    if (lotId) {
      params.lotId = lotId;
    }
    if (lotNo) {
      params.lotNo = lotNo;
    }
    if (expDate) {
      params.expDate = expDate;
    }

    return requestJson({
      method: "GET",
      url: `/api/products/${encodeURIComponent(id)}/unit-levels`,
      params: Object.keys(params).length ? params : undefined,
    });
  },
  lotWhitelists(productId) {
    const id = String(productId || "").trim();
    if (!id) {
      return Promise.resolve({ productId: "", unitLevels: [], lots: [] });
    }

    return requestJson({
      method: "GET",
      url: `/api/products/${encodeURIComponent(id)}/lot-whitelists`,
    });
  },
  updateLotWhitelist(productId, lotId, payload = {}) {
    const id = String(productId || "").trim();
    const normalizedLotId = String(lotId || "").trim();
    if (!id) {
      throw new Error("productId is required");
    }
    if (!normalizedLotId) {
      throw new Error("lotId is required");
    }

    return requestJson({
      method: "PUT",
      url: `/api/products/${encodeURIComponent(id)}/lots/${encodeURIComponent(normalizedLotId)}/whitelist`,
      data: {
        allowedUnitLevelIds: Array.isArray(payload?.allowedUnitLevelIds)
          ? payload.allowedUnitLevelIds
          : [],
        defaultUnitLevelId: String(payload?.defaultUnitLevelId || "").trim() || null,
      },
    });
  },
  reportGroups() {
    return requestJson({
      method: "GET",
      url: "/api/products/report-groups",
    });
  },
  genericNames() {
    return requestJson({
      method: "GET",
      url: "/api/products/generic-names",
    });
  },
  activeIngredients(search = "") {
    const value = String(search || "").trim();
    return requestJson({
      method: "GET",
      url: "/api/active-ingredients",
      params: value ? { q: value } : undefined,
    });
  },
  unitTypes(search = "") {
    const value = String(search || "").trim();
    return requestJson({
      method: "GET",
      url: "/api/products/unit-types",
      params: value ? { q: value } : undefined,
    });
  },
  create(payload) {
    return requestJson({
      method: "POST",
      url: "/api/products",
      data: payload,
    });
  },
  update(id, payload) {
    return requestJson({
      method: "PUT",
      url: `/api/products/${id}`,
      data: payload,
    });
  },
  remove(id) {
    return requestJson({
      method: "DELETE",
      url: `/api/products/${id}`,
    });
  },
};

export const INVENTORY_CHANGED_EVENT = "inventory:changed";

function emitInventoryChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INVENTORY_CHANGED_EVENT));
}

export const inventoryApi = {
  async createMovement(payload = {}) {
    const requestPayload = buildMovementWriteRequestPayload(payload);
    const response = await requestJson({
      method: "POST",
      url: "/api/inventory/movements",
      data: requestPayload,
    });
    emitInventoryChanged();
    return response;
  },
  async createMovementBatch(movements = []) {
    const list = Array.isArray(movements) ? movements : [];
    if (!list.length) {
      throw new Error("movements must contain at least one item");
    }

    const requestPayload = list.map((movement) => buildMovementWriteRequestPayload(movement));
    const response = await requestJson({
      method: "POST",
      url: "/api/inventory/movements/batch",
      data: {
        movements: requestPayload,
      },
    });
    emitInventoryChanged();
    return response;
  },
  updateMovementOccurredAtCorrection(id, payload = {}) {
    const movementId = String(id || "").trim();
    const correctedOccurredAt = normalizeBangkokDateTimeInput(
      String(payload.correctedOccurredAt ?? payload.corrected_occurred_at ?? payload.occurredAt ?? "").trim()
    );
    const reason = String(payload.reason ?? payload.reasonText ?? payload.reason_text ?? "").trim();

    if (!movementId) {
      throw new Error("movement id is required");
    }
    if (!correctedOccurredAt) {
      throw new Error("correctedOccurredAt is required");
    }
    if (!reason) {
      throw new Error("reason is required");
    }

    return requestJson({
      method: "PATCH",
      url: `/api/inventory/movements/${encodeURIComponent(movementId)}/occurred-at-correction`,
      data: {
        correctedOccurredAt,
        reason,
      },
    });
  },
  receive(payload) {
    return requestJson({
      method: "POST",
      url: "/api/inventory/receive",
      data: payload,
    });
  },
  transfer(payload) {
    return requestJson({
      method: "POST",
      url: "/api/inventory/transfer",
      data: payload,
    });
  },
  listTransferRequests({ status, limit, location_id } = {}) {
    const params = {};
    if (status) {
      params.status = String(status).trim();
    }
    if (location_id) {
      params.location_id = String(location_id).trim();
    }
    if (limit !== undefined && limit !== null && Number.isFinite(Number(limit))) {
      params.limit = String(Math.min(Math.max(Math.floor(Number(limit)), 1), 100));
    }

    return requestJson({
      method: "GET",
      url: "/api/inventory/transfer-requests",
      params: Object.keys(params).length ? params : undefined,
    });
  },
  async acceptTransferRequest(id, payload = {}) {
    const requestId = String(id || "").trim();
    if (!requestId) {
      throw new Error("transfer request id is required");
    }

    const response = await requestJson({
      method: "POST",
      url: `/api/inventory/transfer-requests/${encodeURIComponent(requestId)}/accept`,
      data: {
        note: String(payload.note ?? payload.decisionNote ?? "").trim() || undefined,
      },
    });
    emitInventoryChanged();
    return response;
  },
  async rejectTransferRequest(id, payload = {}) {
    const requestId = String(id || "").trim();
    const reason = String(payload.reason ?? payload.decisionNote ?? "").trim();
    if (!requestId) {
      throw new Error("transfer request id is required");
    }
    if (!reason) {
      throw new Error("reason is required");
    }

    const response = await requestJson({
      method: "POST",
      url: `/api/inventory/transfer-requests/${encodeURIComponent(requestId)}/reject`,
      data: { reason },
    });
    emitInventoryChanged();
    return response;
  },
  listStockOnHand(filters = {}) {
    return requestJson({
      method: "GET",
      url: "/api/stock/on-hand",
      params: buildStockOnHandParams(filters),
    });
  },
  stockOnHand(branchCode = "") {
    return requestJson({
      method: "GET",
      url: "/api/stock/on-hand",
      params: buildStockOnHandParams({ branchCode }),
    });
  },
  movements(filters = {}) {
    const params = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      const text = String(value).trim();
      if (!text) return;
      params[key] = text;
    });
    return requestJson({
      method: "GET",
      url: "/api/movements",
      params: Object.keys(params).length ? params : undefined,
    });
  },
  listMovements({ location_id, limit, fromDate, toDate, productId } = {}) {
    const params = {};
    if (location_id) {
      params.location_id = String(location_id).trim();
    }
    if (productId) {
      params.productId = String(productId).trim();
    }
    if (fromDate) {
      params.fromDate = String(fromDate).trim();
    }
    if (toDate) {
      params.toDate = String(toDate).trim();
    }
    if (limit !== undefined && limit !== null && Number.isFinite(Number(limit))) {
      params.limit = String(Math.min(Math.max(Math.floor(Number(limit)), 1), 1000));
    }

    return requestJson({
      method: "GET",
      url: "/api/movements",
      params: Object.keys(params).length ? params : undefined,
    });
  },
  listLocations({ includeInactive, locationType } = {}) {
    const params = {};
    if (includeInactive !== undefined) {
      params.includeInactive = includeInactive ? "true" : "false";
    }
    if (locationType) {
      params.locationType = String(locationType).trim();
    }

    return requestJson({
      method: "GET",
      url: "/api/locations",
      params: Object.keys(params).length ? params : undefined,
    });
  },
};

export const dispenseApi = {
  create(payload) {
    return requestJson({
      method: "POST",
      url: "/api/dispense",
      data: payload,
    });
  },
  history(filters = {}) {
    const params = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      const text = String(value).trim();
      if (!text) return;
      params[key] = text;
    });
    return requestJson({
      method: "GET",
      url: "/api/dispense/history",
      params: Object.keys(params).length ? params : undefined,
    });
  },
  byPid(pid, filters = {}) {
    const params = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      const text = String(value).trim();
      if (!text) return;
      params[key] = text;
    });
    return requestJson({
      method: "GET",
      url: `/api/patients/${encodeURIComponent(pid)}/dispense`,
      params: Object.keys(params).length ? params : undefined,
    });
  },
};

export const adminApi = {
  executeSql(sql) {
    const text = String(sql ?? "").trim();
    if (!text) {
      throw new Error("sql is required");
    }

    return requestJson({
      method: "POST",
      url: "/api/admin/sql/execute",
      data: { sql: text },
    });
  },
};
