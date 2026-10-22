import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("main Compose includes all five services and shares Word configuration without a second overlay", () => {
  const compose = read("compose.yaml");
  const services = compose.split("\nvolumes:")[0];
  assert.deepEqual([...services.matchAll(/^  ([a-z-]+):$/gm)].map(match => match[1]).sort(),
    ["onlyoffice", "template-db", "template-service", "web", "word-gateway"]);
  const web = services.split("  web:\n")[1].split("  template-service:\n")[0];
  assert.doesNotMatch(web, /ports:/);
  assert.match(compose, /127\.0\.0\.1:5173:8080/);
  assert.equal((compose.match(/\$\{ONLYOFFICE_JWT_SECRET:\?/g) || []).length, 2);
  assert.match(compose, /ONLYOFFICE_INTERNAL_URL: http:\/\/onlyoffice/);
  assert.match(compose, /WORD_CONVERSION_ENGINE: onlyoffice/);
  assert.match(compose, /ONLYOFFICE_CALLBACK_BASE: http:\/\/template-service:8000/);
  for (const volume of ["template-postgres", "onlyoffice-data", "onlyoffice-library"])
    assert.match(compose, new RegExp(`^  ${volume}:$`, "m"));
});

test("local Compose mounts source with hot reload without replacing container dependencies or DB storage", () => {
  const compose = read("compose.yaml");
  for (const value of ["target: development", "./app:/web/app:ro", "./lib:/web/lib:ro",
    "./public:/web/public", "./backend/app:/service/app:ro", '"--reload"',
    'WATCHFILES_FORCE_POLLING: "true"', 'DEV_USE_POLLING: "true"',
    "template-postgres:/var/lib/postgresql/data"])
    assert.ok(compose.includes(value), value);
  assert.doesNotMatch(compose, /- \.\/:|\.env:|node_modules:|\.venv:/);
});

test("the development target does not build bundles, while built preview retains the immutable build", () => {
  const docker = read("Dockerfile.web");
  const dev = docker.split("FROM source AS development")[1].split("FROM source AS built-preview")[0];
  assert.match(dev, /vinext\/dist\/cli\.js dev/);
  assert.match(dev, /prepare-ocr-assets/);
  assert.doesNotMatch(dev, /RUN npm run build/);
  assert.match(docker.split("FROM source AS built-preview")[1], /RUN npm run build/);
  assert.doesNotMatch(read("backend/Dockerfile"), /--reload/);
});

test("dev routing and polling support mounted sources and testing-tunnel HMR", () => {
  const vite = read("vite.config.ts"), nginx = read("deploy/quick-test/nginx.conf");
  assert.match(vite, /DEV_USE_POLLING/);
  assert.match(vite, /TEMPLATE_DEV_API_PROXY/);
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(nginx, /proxy_set_header Connection \$report_connection_upgrade/);
});
