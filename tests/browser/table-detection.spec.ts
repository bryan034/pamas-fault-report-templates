import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

test("local OCR detects unruled load-table rows without turning headers into inputs", async ({ page }) => {
  test.setTimeout(120_000);
  const pdf = execFileSync(resolve("backend/.venv/bin/python"), ["-c", `
import sys
sys.path.insert(0, 'tests')
from test_table_detection import load_table
import pypdfium2 as pdfium
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from io import BytesIO
document = pdfium.PdfDocument(load_table(extra_box=True))
image = document[0].render(scale=3).to_pil()
out = BytesIO()
pdf = canvas.Canvas(out, pagesize=(400,500))
pdf.drawImage(ImageReader(image),0,0,400,500)
pdf.showPage()
pdf.save()
sys.stdout.buffer.write(out.getvalue())
`], { cwd: resolve("backend"), env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  await page.goto("/templates/new");
  await page.getByLabel("Upload report PDF or Word document").setInputFiles({
    name: "Scanned load table.pdf", mimeType: "application/pdf", buffer: pdf,
  });
  await page.getByRole("button", { name: "Detect scanned page 1 with local OCR" }).click();
  await expect(page.getByRole("button", { name: "Detect scanned page 1 with local OCR" })).toHaveCount(0, { timeout: 90000 });
  const layer = page.getByLabel("Template field review, page 1", { exact: true });
  await expect(layer.locator('[data-box-kind="field"]')).toHaveCount(13);
  const saving = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/templates"));
  await page.getByRole("button", { name: "Save template", exact: true }).click();
  const response = await saving;
  expect(response.status()).toBe(200);
  const saved = await response.json();
  const body = JSON.stringify(saved);
  expect(saved.definition.clear_areas).toHaveLength(saved.definition.fields.length);
  for (const field of saved.definition.fields) {
    expect(saved.definition.clear_areas.find((cover: { id: string }) => cover.id === field.id))
      .toMatchObject({ id: field.id, page: field.page, x: field.x, y: field.y,
        width: field.width, height: field.height, color: "#ffffff" });
  }
  expect(body).toContain("L1 Rated");
  expect(body).toContain("L3 Measured");
  expect(body.match(/"operation":"percentage"/g)).toHaveLength(4);
  await expect(page.getByRole("heading", { name: "Template saved successfully" })).toBeVisible();
});
