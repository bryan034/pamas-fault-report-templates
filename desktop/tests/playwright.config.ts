import { defineConfig } from "@playwright/test";

// Drives the real Electron shell and backend with a throwaway profile folder.
export default defineConfig({
  testDir: ".",
  outputDir: "../.build/test-results",
  workers: 1,
  timeout: 180_000,
  use: { actionTimeout: 20_000, trace: "retain-on-failure" },
});
