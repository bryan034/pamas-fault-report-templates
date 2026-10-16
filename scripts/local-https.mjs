import { mkdir, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localHttpsAddresses } from "./local-https-hosts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
if (process.argv.length > 3) throw new Error("Usage: npm run dev:https -- [WIFI_IP]");
const addresses = localHttpsAddresses(networkInterfaces(), process.argv[2]);
const directory = new URL("../.local-https/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("hosts.env", directory),
  `LOCAL_HTTPS_HOSTS=${addresses.map((host) => `https://${host}:5173`).join(", ")}\nLOCAL_HTTPS_DEFAULT_SNI=${addresses[1]}\n`);

function docker(args, quiet = false) {
  const result = spawnSync("docker", ["compose", ...args], { cwd: root, stdio: quiet ? "ignore" : "inherit" });
  if (result.error) throw result.error;
  return result.status === 0;
}
if (!docker(["up", "--build", "-d", "--wait", "--wait-timeout", "180"])) process.exit(1);
if (!docker(["exec", "-T", "https", "caddy", "reload", "--config", "/etc/caddy/Caddyfile"])) process.exit(1);
let ready = false;
for (let attempt = 0; attempt < 20; attempt++) {
  if (docker(["exec", "-T", "https", "test", "-r", "/data/caddy/pki/authorities/local/root.crt"], true)) {
    ready = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready || !docker(["cp", "https:/data/caddy/pki/authorities/local/root.crt", ".local-https/root.crt"]))
  throw new Error("Could not export the local CA certificate. Check: docker compose logs https");

console.log("\nHTTPS addresses (use the laptop's Wi-Fi IP on other devices):");
for (const host of addresses) console.log(`  https://${host}:5173`);
console.log("\nTrust .local-https/root.crt on each device. No system trust store has been changed.");
console.log("See docs/local-https.md. Share only root.crt, never the CA's private keys.");
