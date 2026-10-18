import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  approvedEmails,
  connectorImage,
  quickUrl,
  isLoginRedirect,
  quickAccessMode,
} from "./quick-https-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const [action = "start", ...addresses] = process.argv.slice(2);
const saved = existsSync(new URL("../.env.quick", import.meta.url))
  ? parseEnv(readFileSync(new URL("../.env.quick", import.meta.url), "utf8"))
  : {};
const environment = { ...process.env };
const compose = [
  "compose",
  "-f",
  "compose.yaml",
  "-f",
  "compose.quick-test.yaml",
];

function docker(args, capture = false) {
  const result = spawnSync("docker", args, {
    cwd: root,
    env: environment,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      "Docker command failed. Check Docker Desktop, service health and whether port 8088 is free.",
    );
  return (result.stdout || "").trim();
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (url, timeoutMs = 5000) =>
  fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });

async function start() {
  // Validate before any Docker service is created or any public URL is requested.
  const publicMode = quickAccessMode(
    process.env.QUICK_TEST_ACCESS || saved.QUICK_TEST_ACCESS || "email",
  ) === "public";
  if (publicMode && addresses.length)
    throw new Error("Public mode does not accept email arguments. Set QUICK_TEST_ACCESS=email to restrict access.");
  // The public overlay replaces the whole command, so this parse-only placeholder
  // never reaches cloudflared. It is not a fake authentication identity.
  environment.QUICK_TEST_ALLOWED_EMAILS = publicMode ? "unused-in-public-mode@example.invalid" : approvedEmails(
    addresses.length
      ? addresses.join(",")
      : process.env.QUICK_TEST_ALLOWED_EMAILS ||
          saved.QUICK_TEST_ALLOWED_EMAILS,
  );
  if (publicMode) {
    compose.push("-f", "compose.quick-public.yaml");
    console.warn("WARNING: PUBLIC TESTING — no login. Anyone with the URL can view, edit and permanently delete your existing testing data.");
  }
  docker([...compose, "config", "--quiet"]);
  for (const service of ["web", "template-service", "template-db"]) {
    if (
      !docker(
        [
          "compose",
          "-f",
          "compose.yaml",
          "ps",
          "--status",
          "running",
          "-q",
          service,
        ],
        true,
      )
    )
      throw new Error(
        `Start your existing local ${service} service first. This launcher does not create or replace your database.`,
      );
  }
  const identity = await request("http://127.0.0.1:8001/api/access/me");
  if (!identity.ok || (await identity.json()).mode !== "local")
    throw new Error(
      "This testing launcher requires the existing no-login local mode. It will not disable configured application authentication.",
    );
  const database = docker(
    ["compose", "-f", "compose.yaml", "ps", "-q", "template-db"],
    true,
  );
  const mounts = JSON.parse(
    docker(["inspect", database, "--format", "{{json .Mounts}}"], true),
  );
  const volume = mounts.find(
    (mount) =>
      mount.Type === "volume" &&
      mount.Destination === "/var/lib/postgresql/data",
  );
  if (!volume)
    throw new Error(
      "Could not confirm the existing PostgreSQL data volume; refusing to proceed.",
    );
  console.log(`Reusing existing PostgreSQL volume: ${volume.Name}`);
  console.log(
    publicMode
      ? "Public visitors have editing access. Application Owner/Editor/Viewer roles are not active."
      : "Approved testers have editing access. This does not activate application Owner/Editor/Viewer roles.",
  );
  const help = docker(
    ["run", "--rm", connectorImage, "tunnel", "--help"],
    true,
  );
  if (!publicMode && !help.includes("--allowed-mail"))
    throw new Error(
      "Connector lacks email protection; no public tunnel was started.",
    );
  docker([
    ...compose,
    "up",
    "-d",
    "--no-deps",
    "--force-recreate",
    "quick-gateway",
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await request("http://127.0.0.1:8088/api/access/me");
      if (response.ok && (await response.json()).mode === "local") {
        ready = true;
        break;
      }
    } catch {
      /* Let NGINX start; never start the connector before routing works. */
    }
    await sleep(500);
  }
  if (!ready)
    throw new Error(
      "The local HTTP gateway could not reach the existing API. No public tunnel was started.",
    );
  let published = false;
  try {
    published = true; // Also clean up a partially started connector on failure.
    docker([
      ...compose,
      "up",
      "-d",
      "--no-deps",
      "--force-recreate",
      "quick-tunnel",
    ]);
    let url = null;
    for (let attempt = 0; attempt < 45; attempt++) {
      url = quickUrl(
        docker(
          [...compose, "logs", "--no-color", "--tail", "100", "quick-tunnel"],
          true,
        ),
      );
      if (url) break;
      await sleep(1000);
    }
    if (!url)
      throw new Error("Cloudflare did not provide a temporary URL in time.");
    let gated = false;
    let lastCheck = "No public response received";
    // A newly allocated hostname can take time to become reachable at the edge.
    console.log(publicMode
      ? "Checking public app availability (up to 90 seconds)..."
      : "Checking public email protection (up to 90 seconds; finishes as soon as verified)...");
    const gateDeadline = Date.now() + 90_000;
    while (Date.now() < gateDeadline) {
      try {
        const response = await request(
          `${url}/api/access/me`,
          Math.max(1, Math.min(5000, gateDeadline - Date.now())),
        );
        lastCheck = `Public endpoint returned HTTP ${response.status}`;
        if (publicMode && response.status === 200 && (await response.json()).mode === "local") {
          gated = true;
          break;
        }
        if (!publicMode && isLoginRedirect(response, url)) {
          gated = true;
          break;
        }
        if (!publicMode && response.status === 200)
          throw new Error(
            "STOP: public API did not redirect to verified email login.",
          );
      } catch (error) {
        if (error.message?.startsWith("STOP:")) throw error;
        lastCheck = `Public request failed (${error.cause?.code || error.name || "network error"})`;
      }
      const remaining = gateDeadline - Date.now();
      if (remaining > 0) await sleep(Math.min(1000, remaining));
    }
    if (!gated)
      throw new Error(
        publicMode
          ? `Could not reach the public testing app within 90 seconds; connector will be stopped. ${lastCheck}.`
          : `Could not confirm the public email-login gate within 90 seconds; connector will be stopped. ${lastCheck}. Check DNS/network connectivity and connector logs; email protection has not been disabled.`,
      );
    console.log(`\n${publicMode ? "Public HTTPS testing URL (NO LOGIN)" : "Email-protected testing URL"}: ${url}`);
    console.log(
      publicMode
        ? "Anyone with this link can edit/delete testing data. Keep the tunnel running only while testing."
        : "Anonymous API requests redirect to Cloudflare login. Sign in and test the app from another device.",
    );
    console.log("Stop remote access with: npm run dev:quick:stop");
  } catch (error) {
    if (published) docker([...compose, "stop", "quick-tunnel"]);
    throw error;
  }
}

try {
  if (action === "start") await start();
  else if (action === "stop") {
    // This value only permits Compose to parse the file during cleanup. It
    // cannot start a connector: the only command here removes these sidecars.
    environment.QUICK_TEST_ALLOWED_EMAILS = "stop-only@example.invalid";
    docker([
      ...compose,
      "rm",
      "--stop",
      "--force",
      "quick-tunnel",
      "quick-gateway",
    ]);
    console.log(
      "Quick Tunnel and router removed. Existing web/API/database and volume were not removed.",
    );
  } else
    throw new Error(
      "Usage: npm run dev:quick -- real-email@example.com [another-email@example.com], or npm run dev:quick:stop",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
