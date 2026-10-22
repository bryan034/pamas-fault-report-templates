import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
const read = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("local stack has no TLS gateway, public LAN listeners, or CA volume", () => {
  const compose = read("compose.yaml");
  assert.doesNotMatch(compose, /caddy|local-https|5175|0\.0\.0\.0:5173/);
  for (const port of ["5173:8080", "8001:8000", "5434:5432"])
    assert.ok(compose.includes(`127.0.0.1:${port}`));
  assert.ok(compose.includes("template-postgres:/var/lib/postgresql/data"));
  for (const file of [
    "deploy/local/Caddyfile",
    "scripts/local-https.mjs",
    "scripts/local-https-hosts.mjs",
  ])
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false);
});
test("tunnel fails on missing security settings and does not publish a port", () => {
  const compose = read("compose.tunnel.yaml");
  for (const name of [
    "TUNNEL_TOKEN",
    "TEMPLATE_OWNER_EMAIL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "TEMPLATE_PUBLIC_ORIGIN",
  ]) {
    assert.ok(compose.includes(`${name}:`));
    assert.ok(compose.includes(`\${${name}:?`));
    assert.ok(read(".env.tunnel.example").includes(`${name}=`));
  }
  assert.doesNotMatch(compose, /ports:/);
  assert.match(compose, /networks: \[default, protected-tunnel\]/);
  assert.match(compose, /networks: \[protected-tunnel\]/);
  assert.match(compose, /TEMPLATE_ACCESS_MODE: google/);
  assert.match(read(".gitignore"), /\.env\*/);
});
