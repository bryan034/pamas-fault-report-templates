import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

test("DOCX upload opens the original field-box builder, not a Word processor", async ({ page }) => {
  const fixture = JSON.parse(execFileSync(resolve("backend/.venv/bin/python"), ["-c",
    "import sys,runpy,json,base64;sys.path.insert(0,'tests');w=runpy.run_path('tests/test_word_templates.py');p=runpy.run_path('tests/test_templates.py');print(json.dumps({'word':base64.b64encode(w['sample_word']()).decode(),'pdf':base64.b64encode(p['sample_pdf']()).decode(),'definition':p['definition']().model_dump(mode='json')}))"],
    { cwd: resolve("backend") }).toString());
  // Renderer HTTP contract is tested separately against the real Docker service.
  await page.route("**/api/templates/analyze", async route => {
    expect(route.request().postDataBuffer()?.includes(Buffer.from("inspection.docx"))).toBeTruthy();
    await route.fulfill({ json: { definition: fixture.definition, scanned_pages: [], source_format: "docx", render_pdf: fixture.pdf } });
  });
  await page.goto("/templates/new");
  await page.getByLabel("Upload report PDF or Word document").setInputFiles({
    name: "inspection.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(fixture.word, "base64"),
  });
  await expect(page.getByRole("toolbar", { name: "Template editing tools" })).toBeVisible();
  await expect(page.getByLabel("Field label", { exact: true })).toBeVisible();
  await page.getByLabel("Field label", { exact: true }).fill("Overlay company");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Word editor" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save template", exact: true })).toBeVisible();
});
