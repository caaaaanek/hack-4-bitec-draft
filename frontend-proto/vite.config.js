import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api/v1 — бекенд (за замовчуванням локальний uvicorn на 8011), /api/assistant — server.mjs або Vercel.
const backend = process.env.BACKEND_URL || "http://127.0.0.1:8011";
export default defineConfig({
  plugins: [react()],
  base: "/",
  server: { proxy: { "/api/v1": backend } },
  preview: { proxy: { "/api/v1": backend } },
  build: { outDir: "dist", emptyOutDir: true },
});
