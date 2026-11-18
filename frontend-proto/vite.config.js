import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Увесь /api (і /api/v1, і /api/assistant) та /health іде на бекенд: так само, як nginx у Docker.
// За замовчуванням — локальний uvicorn на 8000 (порт з backend/README.md); інший: BACKEND_URL=http://host:port.
const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const proxy = { "/api": backend, "/health": backend };
export default defineConfig({
  plugins: [react()],
  base: "/",
  server: { proxy },
  preview: { proxy },
  build: { outDir: "dist", emptyOutDir: true, rollupOptions: { output: { manualChunks: { react: ["react", "react-dom"] } } } },
});
