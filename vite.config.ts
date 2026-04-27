import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/atlas-globe/" : "/",
  plugins: [react(), cesium()],
  server: {
    host: "127.0.0.1",
    port: 5180
  },
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 4000
  }
}));
