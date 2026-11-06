import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "**/.wrangler/**",
    "next-env.d.ts",
    "dist/**",
    ".vinext/**",
    ".sites-runtime/**",
    "backend/.venv/**",
    "backend/.uv-cache/**",
    "public/ocr/**",
    "public/pdf.worker.min.mjs",
    ".playwright/**",
    "test-results/**",
    "playwright-report/**",
    "vendor/**",
    "desktop/.build/**",
    "desktop/dist/**",
    "desktop/node_modules/**",
  ]),
  {
    // Electron's main and preload entry points are CommonJS.
    files: ["desktop/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
