import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

test("saved report PDF backgrounds include the HttpOnly session cookie across local ports", async ({page, context, request}) => {
  const seed = JSON.parse(execFileSync(resolve("backend/.venv/bin/python"), ["-c",
    "import runpy,json,base64;t=runpy.run_path('tests/test_templates.py');d=t['definition']().model_dump();d['ocr_mappings']=[];print(json.dumps({'pdf':base64.b64encode(t['sample_pdf']()).decode(),'definition':d}))",
  ], {cwd: resolve("backend")}).toString());
  const api = "http://127.0.0.1:8011/api/templates";
  const created = await request.post(api, {multipart: {
    title: "Session-protected background", definition_json: JSON.stringify(seed.definition),
    pdf: {name: "Form.pdf", mimeType: "application/pdf", buffer: Buffer.from(seed.pdf, "base64")},
  }});
  expect(created.ok()).toBe(true);
  const template = await created.json();
  const saved = await request.post(`${api}/${template.id}/drafts`, {multipart: {
    report_json: JSON.stringify({title: "Authenticated draft", values: {company: "Saved company"}}),
  }});
  expect(saved.ok()).toBe(true);
  const draft = await saved.json();
  await context.addCookies([{
    name: "report_session", value: "pdf-preview-regression", domain: "127.0.0.1",
    path: "/api", httpOnly: true, secure: false, sameSite: "Lax",
  }]);
  let authenticated = 0, rejected = 0;
  // The test service is isolated/local. Emulate its production cookie gate for
  // PDF.js network requests, rather than mocking a successful PDF unconditionally.
  await page.route("**/api/templates/*/background?*", async route => {
    if (!(await route.request().allHeaders()).cookie?.includes("report_session=pdf-preview-regression")) {
      rejected++;
      await route.fulfill({status: 401, json: {detail: "Sign in required"}});
    } else {
      authenticated++;
      await route.continue();
    }
  });
  await page.goto(`/templates/custom/${template.id}/drafts/${draft.id}`);
  await expect(page.getByLabel("PDF page 1", {exact: true})).toBeVisible();
  await expect(page.getByLabel("PDF page 2", {exact: true})).toBeVisible();
  expect(authenticated).toBeGreaterThan(0);
  expect(rejected).toBe(0);
  await expect(page.getByText(/Unexpected server response/)).toHaveCount(0);
  await expect(page.getByLabel("Company", {exact: true})).toHaveValue("Saved company");
  await page.reload();
  await expect(page.getByLabel("PDF page 1", {exact: true})).toBeVisible();
  expect(rejected).toBe(0);
});
