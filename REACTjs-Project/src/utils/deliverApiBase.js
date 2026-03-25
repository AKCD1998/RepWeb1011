const LOCAL_API_BASE = "";

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

  return LOCAL_API_BASE;
}
