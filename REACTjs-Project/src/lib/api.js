import { authApiClient } from "./authApi";

async function requestJson(config) {
  const response = await authApiClient.request(config);
  if (response.status === 204) return null;
  return response.data;
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
  reportGroups() {
    return requestJson({
      method: "GET",
      url: "/api/products/report-groups",
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

export const inventoryApi = {
  async createMovement(payload = {}) {
    const movementType = String(payload.movementType || "").trim().toUpperCase();
    const productId = String(payload.productId || "").trim();
    const qty = Number(payload.qty);
    const unitLabel = String(payload.unitLabel || payload.unit || "").trim();
    const fromLocationId = String(
      payload.from_location_id ?? payload.fromLocationId ?? ""
    ).trim();
    const toLocationId = String(payload.to_location_id ?? payload.toLocationId ?? "").trim();

    if (!movementType) {
      throw new Error("movementType is required");
    }
    if (!productId) {
      throw new Error("productId is required");
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error("qty must be a positive number");
    }
    if (!unitLabel) {
      throw new Error("unitLabel is required");
    }

    const occurredAt = payload.occurredAt;
    const note = String(payload.note || "").trim() || null;
    const requestPayload = {
      movementType,
      productId,
      qty,
      unitLabel,
      occurredAt,
      note,
    };

    if (fromLocationId) {
      requestPayload.from_location_id = fromLocationId;
    }
    if (toLocationId) {
      requestPayload.to_location_id = toLocationId;
    }

    return requestJson({
      method: "POST",
      url: "/api/inventory/movements",
      data: requestPayload,
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
  stockOnHand(branchCode = "") {
    const value = String(branchCode || "").trim();
    return requestJson({
      method: "GET",
      url: "/api/stock/on-hand",
      params: value ? { branchCode: value } : undefined,
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
