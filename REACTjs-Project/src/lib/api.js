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
