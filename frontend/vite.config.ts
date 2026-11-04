import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // ECORECRM 精简版不包含 WhatsApp 插件，只保留后端 API 代理。
      // 后端默认端口 4290（见 .env.development.local），可用 VITE_API_TARGET 覆盖。
      "/uploads": process.env.VITE_API_TARGET || "http://127.0.0.1:4290",
      "/api": process.env.VITE_API_TARGET || "http://127.0.0.1:4290"
    }
  }
});
