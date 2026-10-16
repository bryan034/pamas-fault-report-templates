import vinext from "vinext";
import { defineConfig } from "vite"; // helps editor understand valid config options and provide type checking, supports async configs. {} mean named import
import hostingConfig from "./.openai/hosting.json"; 
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID = //unrelated to postgresql pw
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig; //d1 is cloudflare database service, r2 is object storage svc

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = { 
  main: "vinext/server/fetch-handler", //set worker entrypoint to vinext req handler (identifies js module that handles incoming fe http req. not a url and doesnt refer to python api)
  compatibility_flags: ["nodejs_compat"], //enable cloudflare comapbitibility features 
  d1_databases: d1 //checks if d1 is truthy
    ? [ //starts array used when that condition is true
        {
          binding: d1, //name worker code uses to access resource
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [], // ternary expression condition ? valifTrue : valifFalse
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

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
      ...(managedLinux ? { allowedHosts: ["terminal.local"] } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}), //instead of relying on filesystem notifs, vite periodically checks files for changes
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] }, //rsc = react server components, ssr = server side rendering
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
