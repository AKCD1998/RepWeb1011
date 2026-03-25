import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = String(env.VITE_API_PROXY_TARGET || "http://localhost:5050").trim();

  return {
    base: "./",
    plugins: [react()],
    server:
      command === "serve"
        ? {
            proxy: {
              "/api": {
                target: proxyTarget,
                changeOrigin: true,
              },
            },
          }
        : undefined,
  };
});
