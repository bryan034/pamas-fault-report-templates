import vinext from "vinext";
import { defineConfig } from "vite";

// Production is deliberately separate from vite.config.ts and local Compose.
export default defineConfig(async () => {
  await import("./scripts/sites-env.mjs");
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL = "";
  return {
    define: { "process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL": JSON.stringify("") },
    plugins: [
      vinext(),
      cloudflare({
        configPath: "deploy/cloudflare/web/wrangler.jsonc",
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        // Do not connect a local build to deployed services.
        remoteBindings: false,
      }),
    ],
  };
});
