import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:1421" },
  },
  build: { target: "safari16", outDir: "dist", chunkSizeWarningLimit: 2000 },
  test: { include: ["src/**/*.test.ts"] },
} as any);
