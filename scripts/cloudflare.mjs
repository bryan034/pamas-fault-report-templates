import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [action, environment = "staging", ...extra] = process.argv.slice(2);
if (!["build", "deploy-web", "deploy-api"].includes(action) ||
    !["staging", "production"].includes(environment) || extra.length) {
  throw new Error("Usage: node scripts/cloudflare.mjs build|deploy-web|deploy-api staging|production");
}
const childEnv = { ...process.env, CLOUDFLARE_ENV: environment };
function run(binary, args, useBuiltConfig = false) {
  const env = { ...childEnv };
  // Vite emits a flattened config for the environment selected at build time.
  if (useBuiltConfig) delete env.CLOUDFLARE_ENV;
  const result = spawnSync(process.execPath, [binary, ...args], { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const webConfig = "deploy/cloudflare/web/wrangler.jsonc";
if (action === "deploy-web") {
  const settings = JSON.parse(readFileSync(new URL(`../${webConfig}`, import.meta.url), "utf8")).env[environment];
  if (!settings.routes.length || JSON.stringify(settings.vars).includes("REPLACE_WITH")) {
    throw new Error("Configure the custom domain, Access team domain and AUD in deploy/cloudflare/web/wrangler.jsonc first. See docs/cloudflare-deployment.md.");
  }
}
if (action === "build" || action === "deploy-web") {
  await import("./prepare-ocr-assets.mjs");
  run("node_modules/vite/bin/vite.js", ["build", "--config", "vite.cloudflare.config.ts"]);
  const built = JSON.parse(readFileSync(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));
  if (built.name !== `report-formatter-web-${environment}` || built.assets?.run_worker_first !== true)
    throw new Error("Unexpected build environment or missing asset authentication gate; refusing deployment");
}
if (action === "deploy-web") {
  run("node_modules/wrangler/bin/wrangler.js", ["deploy", "--config", "dist/server/wrangler.json"], true);
}
if (action === "deploy-api") {
  run("node_modules/wrangler/bin/wrangler.js", ["deploy", "--config", "deploy/cloudflare/backend/wrangler.jsonc", "--env", environment]);
}
