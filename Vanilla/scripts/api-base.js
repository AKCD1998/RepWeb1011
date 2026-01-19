const PROD_API_BASE = "https://repweb1011-production.up.railway.app";
const LOCAL_API_BASE = "http://localhost:3001";

function readMetaApiBase() {
  const meta = document.querySelector('meta[name="api-base"]');
  const value = meta?.getAttribute("content");
  return value ? value.trim() : "";
}

function readBodyApiBase() {
  const value = document.body?.dataset?.apiBase;
  return value ? String(value).trim() : "";
}

function isLocalHost() {
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

export function getApiBase() {
  if (window.API_BASE && String(window.API_BASE).trim()) {
    return String(window.API_BASE).trim();
  }

  const metaBase = readMetaApiBase();
  if (metaBase) return metaBase;

  const bodyBase = readBodyApiBase();
  if (bodyBase) return bodyBase;

  return isLocalHost() ? LOCAL_API_BASE : PROD_API_BASE;
}
