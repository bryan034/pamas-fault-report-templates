import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  approvedEmails,
  connectorImage,
  isLoginRedirect,
  quickAccessMode,
  quickUrl,
} from "../scripts/quick-https-config.mjs";

const read = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("public access is explicit; omitted/invalid modes never silently remove login", () => {
  assert.equal(quickAccessMode(), "email");
  assert.equal(quickAccessMode("public"), "public");
  assert.equal(quickAccessMode("email"), "email");
  for (const value of ["", "PUBLIC", "none", "false"])
    assert.throws(() => quickAccessMode(value));
  const publicCompose = read("compose.quick-public.yaml");
  assert.match(publicCompose, /command:/);
  assert.match(publicCompose, /http:\/\/quick-gateway:8080/);
  assert.doesNotMatch(publicCompose, /--allowed-mail|ports:|volumes:/);
});

test("email configuration requires explicit addresses, normalizes and deduplicates", () => {
  assert.equal(
    approvedEmails(" Member@Gmail.com , second@example.com,member@gmail.com "),
    "member@gmail.com,second@example.com",
  );
  for (const value of [
    undefined,
    "",
    " ",
    "example.gmail.com",
    "*@gmail.com",
    "a@example.com,",
    "a@example.com;bad",
    "a@example.com\n--no-autoupdate",
    "a@@example.com",
  ]) {
    assert.throws(() => approvedEmails(value));
  }
});

test("only Cloudflare quick-hostname URLs are extracted from connector logs", () => {
  assert.equal(
    quickUrl("INFO visit https://one-two-three.trycloudflare.com |"),
    "https://one-two-three.trycloudflare.com",
  );
  assert.equal(quickUrl("https://attacker.example.com"), null);
  assert.equal(quickUrl("https://trycloudflare.com"), null);
});

test("gate verification requires an HTTPS Access login redirect, never a data response", () => {
  const base = "https://one-two.trycloudflare.com";
  assert.equal(
    isLoginRedirect(new Response(null, {
      status: 302,
      headers: { Location: "https://login.trycloudflare.com/authorize?state=test" },
    }), base),
    true,
  );
  assert.equal(
    isLoginRedirect(
      new Response(null, {
        status: 302,
        headers: {
          Location: "https://team.cloudflareaccess.com/cdn-cgi/access/login",
        },
      }),
      base,
    ),
    true,
  );
  assert.equal(
    isLoginRedirect(
      new Response(null, {
        status: 302,
        headers: { Location: "/cdn-cgi/access/login" },
      }),
      base,
    ),
    true,
  );
  for (const location of [
    "http://team.cloudflareaccess.com/login",
    "https://evil.test/login",
    "https://cloudflareaccess.com.evil.test/login",
    "https://login.trycloudflare.com.evil.test/authorize",
    "https://another.trycloudflare.com/authorize",
    "/api/templates",
  ]) {
    assert.equal(
      isLoginRedirect(
        new Response(null, { status: 302, headers: { Location: location } }),
        base,
      ),
      false,
    );
  }
  assert.equal(isLoginRedirect(Response.json({ mode: "local" }), base), false);
  assert.equal(
    isLoginRedirect(new Response("Access denied", { status: 403 }), base),
    false,
  );
});

test("sidecar configuration preserves existing service/volume definitions and fails on missing email", () => {
  const compose = read("compose.quick-test.yaml");
  assert.doesNotMatch(
    compose,
    /^  (web|template-service|template-db|template-postgres):/m,
  );
  assert.ok(compose.includes("127.0.0.1:8088:8080"));
  assert.ok(compose.includes(connectorImage));
  assert.ok(compose.includes("--allowed-mail"));
  assert.ok(compose.includes("${QUICK_TEST_ALLOWED_EMAILS:?"));
  assert.equal((compose.match(/restart: "no"/g) || []).length, 2);
  const nginx = read("deploy/quick-test/nginx.conf");
  assert.match(nginx, /proxy_pass http:\/\/template-service:8000;/);
  assert.match(nginx, /proxy_pass http:\/\/web:8787;/);
  assert.doesNotMatch(nginx, /listen .*ssl|ssl_certificate/);
});

test("invalid email fails before Docker or a public connector can be started", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/quick-https.mjs", "start", "example.gmail.com"],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, QUICK_TEST_ACCESS: "email" },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /real email addresses/);
  assert.doesNotMatch(result.stdout, /Reusing existing|testing URL/);
});
