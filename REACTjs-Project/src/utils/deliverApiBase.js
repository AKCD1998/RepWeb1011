const PROD_API_BASE = "https://repweb1011-production.up.railway.app";
const LOCAL_API_BASE = "http://localhost:3001";

const readMetaApiBase = () => {
  if (typeof document === "undefined") return "";
  const meta = document.querySelector('meta[name="api-base"]');
  const value = meta?.getAttribute("content");
  return value ? value.trim() : "";
};

const readBodyApiBase = () => {
  if (typeof document === "undefined") return "";
  const value = document.body?.dataset?.apiBase;
  return value ? String(value).trim() : "";
};

const isLocalHost = () => {
  if (typeof window === "undefined") return false;
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
};

export function getApiBase() {
  const envBase =
    import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_BASE;

  if (envBase && String(envBase).trim()) {
    return String(envBase).trim();
  }

  if (typeof window !== "undefined") {
    if (window.API_BASE && String(window.API_BASE).trim()) {
      return String(window.API_BASE).trim();
    }

    const metaBase = readMetaApiBase();
    if (metaBase) return metaBase;

    const bodyBase = readBodyApiBase();
    if (bodyBase) return bodyBase;
  }

  return isLocalHost() ? LOCAL_API_BASE : PROD_API_BASE;
}
