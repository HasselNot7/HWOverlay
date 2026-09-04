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
      // 编辑器预览 iframe 的同源入口：/preview?preview=1 → 后端的 /。
      // 直接跨域指到 8765 的话，contentDocument 是 null，拖动时没法直改
      // iframe 里的宿主节点做跟手预览（见 EditorPage 的 BACKEND）。
      "^/preview": { target: BACKEND, rewrite: () => "/", changeOrigin: true },
    },
  },
  base: "/admin/",
});
