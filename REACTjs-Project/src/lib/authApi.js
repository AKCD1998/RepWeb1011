import axios from "axios";

const rawApiBase = String(
  import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_BASE_URL || ""
).trim();
const apiBase = rawApiBase.replace(/\/+$/, "");
const rawApiPrefix = String(import.meta.env.VITE_API_PREFIX || "").trim();

function normalizeApiPrefix(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = `/${text.replace(/^\/+|\/+$/g, "")}`;
  return normalized === "/api" ? "" : normalized;
}

export const apiPrefix = normalizeApiPrefix(rawApiPrefix);

export function withApiPrefix(url) {
  const text = String(url || "");
  if (!apiPrefix || !text.startsWith("/api")) return text;
  return text.replace(/^\/api(?=\/|$)/, apiPrefix);
}

export const AUTH_TOKEN_KEY = "rx1011_auth_token";
export const AUTH_USER_KEY = "rx1011_auth_user";
export const AUTH_UNAUTHORIZED_EVENT = "auth:unauthorized";

function readStoredToken() {
  if (typeof window === "undefined") return "";
  return String(window.localStorage.getItem(AUTH_TOKEN_KEY) || "").trim();
}

export function clearAuthStorage() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_USER_KEY);
}

function emitUnauthorized() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
}

function normalizeAxiosError(error) {
  const status = Number(error?.response?.status || 500);
  const payload = error?.response?.data;
  const message =
    (typeof payload === "object" && payload?.error) ||
    error?.message ||
    "Request failed";
  const normalized = new Error(message);
  normalized.status = status;
  normalized.payload = payload;
  return normalized;
}

export const authApiClient = axios.create({
  baseURL: apiBase || undefined,
  headers: {
    "Content-Type": "application/json",
  },
});

authApiClient.interceptors.request.use((config) => {
  if (typeof config.url === "string") {
    config.url = withApiPrefix(config.url);
  }

  const token = readStoredToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

authApiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = Number(error?.response?.status || 0);
    const requestUrl = String(error?.config?.url || "");
    const isLoginRequest = requestUrl.includes("/auth/login");
    const isLogoutRequest = requestUrl.includes("/auth/logout");

    if (status === 401 && !isLoginRequest && !isLogoutRequest) {
      clearAuthStorage();
      emitUnauthorized();
    }

    return Promise.reject(normalizeAxiosError(error));
  }
);

export async function loginRequest(credentials) {
  const response = await authApiClient.post("/api/auth/login", credentials);
  return response.data;
}

export async function logoutRequest() {
  const response = await authApiClient.post("/api/auth/logout");
  return response.data;
}
