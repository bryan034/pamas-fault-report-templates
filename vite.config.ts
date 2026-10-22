import vinext from "vinext";
import { defineConfig } from "vite"; // helps editor understand valid config options and provide type checking, supports async configs. {} mean named import
import { readExecutionProfile } from "./scripts/execution-profile.mjs";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";
const usePolling = isCodexSeatbeltSandbox || process.env.DEV_USE_POLLING === "true";
const devHosts = managedLinux ? ["terminal.local"] : [];
if (process.env.DEV_PUBLIC_ORIGIN) {
  devHosts.push(new URL(process.env.DEV_PUBLIC_ORIGIN).hostname);
  // Temporary testing URLs are allocated only after the web service starts.
  devHosts.push(".trycloudflare.com");
}

export default defineConfig(async () => { //export default makes this the file's main exported value
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false"; // false is a string here not the bool ??= means assign this value only if current value is null or undefined
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin"); 

  return {
    server: {
      host: "0.0.0.0",
      ...(devHosts.length ? { allowedHosts: devHosts } : {}),
      ...(usePolling ? { watch: { useFsEvents: false, usePolling: true, interval: 300 } } : {}), // Docker Desktop mounts and Codex sandboxes may not deliver file events.
      ...(process.env.TEMPLATE_DEV_API_PROXY ? {
        proxy: { "/api": { target: process.env.TEMPLATE_DEV_API_PROXY, changeOrigin: false } },
      } : {}),
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] }, //rsc = react server components, ssr = server side rendering
        inspectorPort: false,
        config: { main: "vinext/server/fetch-handler", compatibility_flags: ["nodejs_compat"] },
      }),
    ],
  };
});
