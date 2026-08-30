import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 开发时 python 服务跑在 8765，vite 跑在 5173；API 走代理，无 CORS 问题。
// 构建产物 dist/ 由 FastAPI 在 /admin 下静态服务。
const BACKEND = "http://127.0.0.1:8765";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": BACKEND,
      "/hw.json": BACKEND,
      "/overlay.json": BACKEND,
      "/metrics.json": BACKEND,
      "/sensors": BACKEND,
    },
  },
  base: "/admin/",
});
