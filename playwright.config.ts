import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const database = join(
  mkdtempSync(join(tmpdir(), "report-template-e2e-")),
  "templates.sqlite",
);
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1100 },
    actionTimeout: 15_000,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "cd backend && UV_CACHE_DIR=.uv-cache uv run python -m uvicorn app.template_main:app --host 127.0.0.1 --port 8011",
      url: "http://127.0.0.1:8011/api/health",
      reuseExistingServer: false,
      env: {
        TEMPLATE_DATABASE_URL: `sqlite+pysqlite:///${database}`,
      },
    },
    {
      command: "npm run dev -- --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NEXT_PUBLIC_TEMPLATE_API_BASE_URL: "http://127.0.0.1:8011" },
    },
  ],
});
