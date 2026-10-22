import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { handleWebRequest } from "../deploy/cloudflare/web/gateway.ts";
import { containerEnvironment } from "../deploy/cloudflare/backend/environment.ts";
import { templateApiBase } from "../lib/template-api.ts";

const request = (path = "/", init = {}) => new Request(`https://reports.example.com${path}`, init);

test("API proxy preserves session cookies, multipart bodies and paths, strips asserted identities", async () => {
  const body = new FormData();
  body.append("report_json", '{"title":"Private report"}');
  body.append("images", new File(["image bytes"], "photo.png", {type: "image/png"}));
  const result = await handleWebRequest(request("/api/templates/id/generate?test=1", {method: "POST", body,
    headers: {Origin: "https://reports.example.com", Cookie: "report_session=opaque", "Cf-Access-Jwt-Assertion": "forged", Authorization: "Bearer forged", "X-Template-Service-Token": "forged", "X-Template-User-Email": "owner@example.com"}}),
  {TEMPLATE_API: {fetch: async forwarded => {
    assert.equal(new URL(forwarded.url).pathname, "/api/templates/id/generate");
    assert.equal(new URL(forwarded.url).search, "?test=1");
    for (const name of ["authorization", "cf-access-jwt-assertion", "x-template-service-token", "x-template-user-email"]) assert.equal(forwarded.headers.get(name), null);
    assert.equal(forwarded.headers.get("Cookie"), "report_session=opaque");
    assert.equal(forwarded.headers.get("Origin"), "https://reports.example.com");
    const parsed = await forwarded.formData();
    assert.equal(parsed.get("report_json"), '{"title":"Private report"}');
    assert.equal(await parsed.get("images").text(), "image bytes");
    return new Response("PDF", {headers: {"Content-Disposition": 'attachment; filename="Private report.pdf"'}});
  }}}, async () => { throw new Error("Must proxy API"); });
  assert.equal(await result.text(), "PDF");
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
});

test("Google callback redirects and both cookies survive the proxy without following redirects", async () => {
  const headers = new Headers({Location: "https://reports.example.com/"});
  headers.append("Set-Cookie", "report_session=new; HttpOnly; Secure; SameSite=Lax; Path=/");
  headers.append("Set-Cookie", "report_oauth_browser=; Max-Age=0; Path=/api/auth");
  const result = await handleWebRequest(request("/api/auth/google/callback?code=private"),
    {TEMPLATE_API: {fetch: async forwarded => {
      assert.equal(forwarded.redirect, "manual");
      return new Response(null, {status: 303, headers});
    }}}, async () => new Response());
  assert.equal(result.status, 303);
  assert.equal(result.headers.getSetCookie().length, 2);
  assert.equal(result.headers.get("Location"), "https://reports.example.com/");
  assert.equal(result.headers.get("Referrer-Policy"), "no-referrer");
});

test("Python authorization failures pass through and network errors do not leak secrets", async () => {
  for (const status of [401, 403]) {
    const result = await handleWebRequest(request("/api/templates"), {TEMPLATE_API: {fetch: async () => new Response("Denied", {status})}}, async () => new Response());
    assert.equal(result.status, status);
  }
  const result = await handleWebRequest(request("/api/templates"), {TEMPLATE_API: {fetch: async () => {throw new Error("secret-db-url");}}}, async () => new Response());
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /secret-db-url/);
  assert.equal((await handleWebRequest(request(), {}, async () => new Response("Public login shell"))).status, 200);
});

test("cloud backend requires database, transport secret and app-owned Google settings", () => {
  const env = {TEMPLATE_DATABASE_URL: "postgresql+psycopg://user:password@host/db?sslmode=require", TEMPLATE_DATABASE_SCHEMA: "report_formatter", TEMPLATE_ENVIRONMENT: "staging", TEMPLATE_SERVICE_TOKEN: "x".repeat(40), TEMPLATE_OWNER_EMAIL: "owner@example.com", TEMPLATE_PUBLIC_ORIGIN: "https://reports.example.com", GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret", ONLYOFFICE_JWT_SECRET: "w".repeat(40)};
  assert.deepEqual(containerEnvironment(env), {...env, TEMPLATE_ACCESS_MODE: "google", TEMPLATE_MIGRATE_ON_START: "true", WORD_CONVERSION_ENGINE: "onlyoffice", ONLYOFFICE_INTERNAL_URL: "http://onlyoffice.internal", ONLYOFFICE_CALLBACK_BASE: "http://templates.internal"});
  for (const change of [{ONLYOFFICE_JWT_SECRET: ""}, {ONLYOFFICE_JWT_SECRET: "short"}, {TEMPLATE_OWNER_EMAIL: ""}, {TEMPLATE_DATABASE_URL: ""}, {TEMPLATE_DATABASE_URL: "postgresql+psycopg://host/db"}, {TEMPLATE_DATABASE_SCHEMA: "public"}, {TEMPLATE_SERVICE_TOKEN: "short"}, {TEMPLATE_ENVIRONMENT: "local"}, {GOOGLE_CLIENT_ID: ""}, {GOOGLE_CLIENT_SECRET: ""}, {TEMPLATE_PUBLIC_ORIGIN: "http://reports.example.com"}])
    assert.throws(() => containerEnvironment({...env, ...change}));
});

test("API base supports cloud same-origin and local development", () => {
  const previous = process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL, oldWindow = globalThis.window;
  try {
    delete process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL;
    globalThis.window = {location: {protocol: "http:", hostname: "localhost"}};
    assert.equal(templateApiBase(), "http://localhost:8001");
    process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL = "";
    assert.equal(templateApiBase(), "");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL;
    else process.env.NEXT_PUBLIC_TEMPLATE_API_BASE_URL = previous;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
});

test("cloud environments isolate private API bindings without Access configuration", () => {
  const read = name => JSON.parse(readFileSync(new URL(`../deploy/cloudflare/${name}/wrangler.jsonc`, import.meta.url)));
  const web = read("web"), backend = read("backend");
  for (const name of ["staging", "production"]) {
    assert.equal(web.env[name].services[0].service, backend.env[name].name);
    assert.deepEqual(backend.env[name].routes, []);
    assert.equal(backend.env[name].workers_dev, false);
    assert.equal(backend.env[name].containers[0].max_instances, 1);
    assert.doesNotMatch(JSON.stringify(web.env[name]), /ACCESS_AUD|ACCESS_TEAM_DOMAIN/);
  }
});


test("private conversion routes permit only conversion, bounded cache downloads and signed sources", async () => {
  const {conversionRoute} = await import("../deploy/cloudflare/backend/conversion.ts");
  assert.equal(conversionRoute(new Request("http://onlyoffice.internal/converter", {method: "POST"})), "converter");
  assert.equal(conversionRoute(new Request("http://onlyoffice.internal/cache/files/job/output.pdf")), "converter");
  assert.equal(conversionRoute(new Request("http://templates.internal/api/word-conversion/12345678-1234-1234-1234-123456789012/source?token=signed")), "source");
  for (const url of ["http://onlyoffice.internal/admin", "http://onlyoffice.internal/converter",
    "http://onlyoffice.internal/cache/files/%252e%252e/private", "https://onlyoffice.internal/cache/files/output.pdf",
    "http://templates.internal/api/templates", "http://evil.test/cache/files/output.pdf",
    "http://templates.internal/api/word-conversion/12345678-1234-1234-1234-123456789012/source"])
    assert.equal(conversionRoute(new Request(url)), null, url);
});

test("both environments provision a separate private ONLYOFFICE container", () => {
  const settings = JSON.parse(readFileSync(new URL("../deploy/cloudflare/backend/wrangler.jsonc", import.meta.url)));
  for (const environment of Object.values(settings.env)) {
    const converter = environment.containers.find(item => item.class_name === "OnlyOfficeContainer");
    assert.equal(converter.image, "../onlyoffice/Dockerfile");
    assert.equal(converter.max_instances, 1);
    assert.ok(environment.durable_objects.bindings.some(item => item.name === "ONLYOFFICE_CONTAINER"));
  }
});


test("converter waits for healthy document services and bounds failed startup", async () => {
  const {waitForConverter} = await import("../deploy/cloudflare/backend/conversion.ts");
  let requests = 0, pauses = 0;
  await waitForConverter({fetch: async request => {
    assert.equal(new URL(request.url).pathname, "/healthcheck");
    return new Response(++requests < 3 ? "false" : "true");
  }}, async () => {pauses++;});
  assert.equal(requests, 3);
  assert.equal(pauses, 2);
  requests = 0;
  await assert.rejects(waitForConverter({fetch: async () => {
    requests++;
    throw new Error("Not listening yet");
  }}, async () => {}), /starting or unavailable/);
  assert.equal(requests, 120);
});
