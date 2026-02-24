const rawApiBase = String(import.meta.env.VITE_API_BASE || "").trim();
const apiBase = rawApiBase.replace(/\/+$/, "");

function toUrl(path) {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return apiBase ? `${apiBase}${safePath}` : safePath;
}

export async function fetchJson(path, options = {}) {
  const { body, headers, ...rest } = options;
  const requestHeaders = {
    "Content-Type": "application/json",
    ...(headers || {}),
  };

  const response = await fetch(toUrl(path), {
    ...rest,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      (typeof data === "object" && data?.error) || response.statusText || "Request failed";
    const error = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

export const productsApi = {
  list(search = "") {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    return fetchJson(`/api/products?${params.toString()}`);
  },
  create(payload) {
    return fetchJson("/api/products", {
      method: "POST",
      body: payload,
    });
  },
  update(id, payload) {
    return fetchJson(`/api/products/${id}`, {
      method: "PUT",
      body: payload,
    });
  },
  remove(id) {
    return fetchJson(`/api/products/${id}`, {
      method: "DELETE",
    });
  },
};

export const inventoryApi = {
  receive(payload) {
    return fetchJson("/api/inventory/receive", {
      method: "POST",
      body: payload,
    });
  },
  transfer(payload) {
    return fetchJson("/api/inventory/transfer", {
      method: "POST",
      body: payload,
    });
  },
  stockOnHand(branchCode = "") {
    const params = new URLSearchParams();
    if (branchCode.trim()) params.set("branchCode", branchCode.trim());
    return fetchJson(`/api/stock/on-hand?${params.toString()}`);
  },
  movements(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        params.set(key, String(value));
      }
    });
    return fetchJson(`/api/movements?${params.toString()}`);
  },
};

export const dispenseApi = {
  create(payload) {
    return fetchJson("/api/dispense", {
      method: "POST",
      body: payload,
    });
  },
  byPid(pid, filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        params.set(key, String(value));
      }
    });
    return fetchJson(`/api/patients/${encodeURIComponent(pid)}/dispense?${params.toString()}`);
  },
};
