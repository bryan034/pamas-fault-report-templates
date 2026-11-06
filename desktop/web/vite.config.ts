import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const shims = path("./next-shims.tsx");

// Static single-page build for the desktop app. Run from the repository root so
// Tailwind scans the same sources as the web build.
export default defineConfig({
  root: path("."),
  publicDir: path("../../public"),
  plugins: [react()],
  css: { postcss: path("../..") }, // The shared Tailwind setup in postcss.config.mjs.
  resolve: {
    alias: {
      "@": path("../.."),
      "next/navigation": shims,
      "next/dynamic": shims,
    },
  },
  define: {
    // Empty selects same-origin /api routes, served by the desktop backend.
    "process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL": JSON.stringify(""),
  },
  build: {
    outDir: path("../.build/web"),
    emptyOutDir: true,
  },
});
