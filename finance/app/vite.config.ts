import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Toolkit serves this app at /finance. Vitest keeps `/` so existing mocks work.
  base: process.env.VITEST ? "/" : "/finance/",
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    // Vite blocks unknown Host headers; Tailscale Serve sends *.ts.net.
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/finance/api": {
        target: "http://127.0.0.1:8787",
        rewrite: (path) => path.replace(/^\/finance/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
