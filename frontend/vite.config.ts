import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxyTarget =
  process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        changeOrigin: true,
        target: apiProxyTarget,
      },
      "/ws": {
        changeOrigin: true,
        target: apiProxyTarget,
        ws: true,
      },
    },
  },
});
