import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { accessIssuer, verifyAccess } from "../deploy/cloudflare/web/access.ts";
import { handleWebRequest } from "../deploy/cloudflare/web/gateway.ts";
import { containerEnvironment } from "../deploy/cloudflare/backend/environment.ts";
import { templateApiBase } from "../lib/template-api.ts";

const settings = { ACCESS_TEAM_DOMAIN: "test-team.cloudflareaccess.com", ACCESS_AUD: "a".repeat(64) };
const approved = async () => ({ sub: "test-user", email: "member@example.com" });
const request = (path = "/", init = {}) => new Request(`https://reports.example.com${path}`, init);

test("Access configuration fails closed and cannot redirect JWKS to an arbitrary host", () => {
  for (const domain of ["", "example.com", "https://test.cloudflareaccess.com", "test.cloudflareaccess.com.evil.test", "test.cloudflareaccess.com/path"]) {
    assert.throws(() => accessIssuer({ ...settings, ACCESS_TEAM_DOMAIN: domain }));
  }
  assert.throws(() => accessIssuer({ ...settings, ACCESS_AUD: "REPLACE_WITH_AUD" }));
  assert.equal(accessIssuer(settings), "https://test-team.cloudflareaccess.com");
});

test("real JWT verification checks signature, issuer, audience, expiry and user claims offline", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "unit-test", alg: "RS256", use: "sig" };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://test-team.cloudflareaccess.com/cdn-cgi/access/certs");
    return Response.json({ keys: [jwk] });
  };
  async function token(overrides = {}, key = privateKey) {
    return new SignJWT({ sub: "member", email: "member@example.com", iss: accessIssuer(settings), aud: settings.ACCESS_AUD,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...overrides })
      .setProtectedHeader({ alg: "RS256", kid: "unit-test" }).sign(key);
  }
  const check = (jwt) => verifyAccess(request("/api/templates", { headers: { "Cf-Access-Jwt-Assertion": jwt } }), settings);
  try {
    assert.equal((await check(await token())).email, "member@example.com");
    await assert.rejects(() => verifyAccess(request(), settings));
    await assert.rejects(() => check("forged-token"));
    for (const overrides of [{ aud: "b".repeat(64) }, { iss: "https://evil.test" }, { exp: 1 }, { email: "" }, { exp: undefined }, { sub: undefined }])
      await assert.rejects(() => token(overrides).then(check));
    await assert.rejects(() => token({}, other.privateKey).then(check));
  } finally { globalThis.fetch = originalFetch; }
});

test("unauthenticated pages, static assets and every API verb are blocked before routing", async () => {
  let reached = 0;
  const next = async () => { reached++; return new Response("private"); };
  const env = { ...settings, TEMPLATE_API: { fetch: next } };
  for (const path of ["/", "/ocr/eng.traineddata.gz", "/api/templates", "/api/templates/1/drafts/2/images/photo"]) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const result = await handleWebRequest(request(path, { method }), env, next, async () => { throw new Error("denied"); });
      assert.equal(result.status, 401);
      assert.equal(result.headers.get("Cache-Control"), "private, no-store");
    }
  }
  const unconfigured = await handleWebRequest(request(), { ...env, ACCESS_AUD: "" }, next, approved);
  assert.equal(unconfigured.status, 503);
  assert.equal(reached, 0);
});

test("same-origin API proxy preserves multipart bodies, downloads and paths, strips credentials", async () => {
  const body = new FormData();
  body.append("report_json", '{"title":"Private report"}');
  body.append("images", new File(["image bytes"], "photo.png", { type: "image/png" }));
  const result = await handleWebRequest(request("/api/templates/id/generate?test=1", { method: "POST", body,
    headers: { Origin: "https://reports.example.com", Cookie: "CF_Authorization=private", "Cf-Access-Jwt-Assertion": "private", Authorization: "Bearer private", "X-Template-Service-Token": "forged", "X-Template-User-Email": "owner@example.com" } }),
  { ...settings, TEMPLATE_API: { fetch: async (forwarded) => {
    assert.equal(new URL(forwarded.url).pathname, "/api/templates/id/generate");
    assert.equal(new URL(forwarded.url).search, "?test=1");
    for (const name of ["cookie", "authorization", "cf-access-jwt-assertion", "x-template-service-token"]) assert.equal(forwarded.headers.get(name), null);
    assert.equal(forwarded.headers.get("X-Template-User-Email"), "member@example.com");
    const parsed = await forwarded.formData();
    assert.equal(parsed.get("report_json"), '{"title":"Private report"}');
    assert.equal(await parsed.get("images").text(), "image bytes");
    return new Response("PDF", { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="Private report.pdf"' } });
  } } }, async () => { throw new Error("Should not render frontend"); }, approved);
  assert.equal(await result.text(), "PDF");
  assert.equal(result.headers.get("Content-Disposition"), 'attachment; filename="Private report.pdf"');
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
});

test("cross-origin writes are rejected and service failures do not expose secrets", async () => {
  const env = { ...settings, TEMPLATE_API: { fetch: async () => { throw new Error("postgres://secret-password"); } } };
  for (const headers of [{ Origin: "https://evil.test" }, { "Sec-Fetch-Site": "cross-site" }]) {
    assert.equal((await handleWebRequest(request("/api/templates", { method: "DELETE", headers }), env, async () => new Response(), approved)).status, 403);
  }
  const result = await handleWebRequest(request("/api/templates"), env, async () => new Response(), approved);
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /secret-password/);
  assert.equal((await handleWebRequest(request("/templates/new"), env, async () => new Response("editor"), approved)).status, 503);
});

test("verified Google identity still needs an owner grant before pages or assets render", async () => {
  let rendered = 0;
  let granted = false;
  const env = {...settings, TEMPLATE_API: {fetch: async (forwarded) => {
    assert.equal(new URL(forwarded.url).pathname, "/api/access/me");
    assert.equal(forwarded.method, "GET");
    assert.equal(forwarded.headers.get("X-Template-User-Email"), "member@example.com");
    for (const name of ["cookie", "cf-access-jwt-assertion", "x-template-service-token"])
      assert.equal(forwarded.headers.get(name), null);
    return granted ? Response.json({mode: "cloudflare", email: "member@example.com", role: "viewer"})
      : Response.json({detail: "Ask owner"}, {status: 403});
  }}};
  const frontend = async () => { rendered++; return new Response("Private application"); };
  for (const path of ["/", "/templates/new", "/access", "/ocr/eng.traineddata.gz"]) {
    const result = await handleWebRequest(request(path), env, frontend, approved);
    assert.equal(result.status, 403);
    assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal(rendered, 0);
  granted = true;
  assert.equal((await handleWebRequest(request(), env, frontend, approved)).status, 200);
  assert.equal(rendered, 1);
  // Revoke without changing the Access token: the next request must be denied.
  granted = false;
  assert.equal((await handleWebRequest(request(), env, frontend, approved)).status, 403);
  assert.equal(rendered, 1);
});

test("page membership lookup fails closed on invalid identity/roles, redirects or service errors", async () => {
  for (const value of [
    {mode: "cloudflare", email: "other@example.com", role: "owner"},
    {mode: "local", email: "member@example.com", role: "editor"},
    {mode: "cloudflare", email: "member@example.com", role: "unknown"},
  ]) {
    const response = await handleWebRequest(request(), {...settings, TEMPLATE_API: {fetch: async () => Response.json(value)}},
      async () => { throw new Error("Must not render"); }, approved);
    assert.equal(response.status, 503);
  }
  for (const status of [302, 500, 503]) {
    const response = await handleWebRequest(request(), {...settings, TEMPLATE_API: {fetch: async () => new Response("postgres://private", {status})}},
      async () => { throw new Error("Must not render"); }, approved);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private/);
  }
});

test("cloud backend requires TLS, private schema, explicit environment and service token", () => {
  const env = { TEMPLATE_DATABASE_URL: "postgresql+psycopg://user:password@host/db?sslmode=require", TEMPLATE_DATABASE_SCHEMA: "report_formatter", TEMPLATE_ENVIRONMENT: "staging", TEMPLATE_SERVICE_TOKEN: "x".repeat(40), TEMPLATE_OWNER_EMAIL: "owner@example.com" };
  assert.deepEqual(containerEnvironment(env), env);
  for (const change of [{ TEMPLATE_OWNER_EMAIL: "" }, { TEMPLATE_DATABASE_URL: "" }, { TEMPLATE_DATABASE_URL: "postgresql+psycopg://host/db" }, { TEMPLATE_DATABASE_SCHEMA: "x; DROP SCHEMA public" }, { TEMPLATE_SERVICE_TOKEN: "short" }, { TEMPLATE_ENVIRONMENT: "local" }])
    assert.throws(() => containerEnvironment({ ...env, ...change }));
});

test("API base supports production same-origin and retains local LAN routing", () => {
  const previous = process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL;
  const oldWindow = globalThis.window;
  try {
    globalThis.window = { location: { protocol: "http:", hostname: "192.168.1.10" } };
    delete process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL;
    assert.equal(templateApiBase(), "http://192.168.1.10:8001");
    globalThis.window.location = { protocol: "https:", hostname: "192.168.1.10", origin: "https://192.168.1.10:5173" };
    assert.equal(templateApiBase(), "https://192.168.1.10:5173");
    process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL = "";
    assert.equal(templateApiBase(), "");
    process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL = "http://127.0.0.1:8011/";
    assert.equal(templateApiBase(), "http://127.0.0.1:8011");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL;
    else process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL = previous;
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
  }
});

test("deploy configurations isolate environments and never expose the API publicly", () => {
  const read = (name) => JSON.parse(readFileSync(new URL(`../deploy/cloudflare/${name}/wrangler.jsonc`, import.meta.url)));
  const web = read("web"), backend = read("backend");
  assert.equal(web.assets.run_worker_first, true);
  for (const name of ["staging", "production"]) {
    for (const config of [web.env[name], backend.env[name]]) {
      assert.equal(config.workers_dev, false);
      assert.equal(config.preview_urls, false);
    }
    assert.equal(web.env[name].services[0].service, backend.env[name].name);
    assert.deepEqual(backend.env[name].routes, []);
    assert.equal(backend.env[name].containers[0].max_instances, 1);
    assert.equal(backend.env[name].vars.TEMPLATE_ENVIRONMENT, name);
  }
  assert.notEqual(web.env.staging.name, web.env.production.name);
});
