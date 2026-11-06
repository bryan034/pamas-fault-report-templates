// Build the static web files. Tailwind scans from the working directory, so run at the root.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
await import(new URL("../../scripts/prepare-ocr-assets.mjs", import.meta.url).href);
const vite = fileURLToPath(new URL("../../node_modules/vite/bin/vite.js", import.meta.url));
const result = spawnSync(process.execPath, [vite, "build", "--config", "desktop/web/vite.config.ts"], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
