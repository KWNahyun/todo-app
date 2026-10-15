import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tauri 가 1420 포트를 봄 (tauri.conf.json devUrl)
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
  test: { environment: "jsdom" },
});
