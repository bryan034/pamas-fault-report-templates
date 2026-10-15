import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";

const shared = "http://127.0.0.1:8011";
function python(code: string) {
  return execFileSync(resolve("backend/.venv/bin/python"), ["-c", code], {
    cwd: resolve("backend"),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
}
const pdf = () =>
  python(
    "import runpy,sys;sys.stdout.buffer.write(runpy.run_path('tests/test_templates.py')['sample_pdf']())",
  );
const definition = () =>
  JSON.parse(
    python(
      "import runpy,json;print(runpy.run_path('tests/test_templates.py')['definition']().model_dump_json())",
    ).toString(),
  );
async function createTemplate(
  request: APIRequestContext,
  title = "Checker template",
  extras = false,
  ocr = false,
) {
  const d = definition();
  if (!ocr) d.ocr_mappings = [];
  if (extras)
    d.fields.push(
      {
        id: "rated",
        label: "Rated current",
        kind: "number",
        page: 1,
        x: 0.4,
        y: 0.3,
        width: 0.15,
        height: 0.07,
      },
      {
        id: "load",
        label: "Load",
        kind: "calculated",
        calculation: { operation: "percentage", fields: ["temp", "rated"] },
        page: 1,
        x: 0.58,
        y: 0.3,
        width: 0.15,
        height: 0.07,
      },
      {
        id: "notes",
        label: "Notes",
        kind: "textarea",
        page: 1,
        x: 0.05,
        y: 0.55,
        width: 0.85,
        height: 0.25,
      },
      {
        id: "time",
        label: "Visit time",
        kind: "time",
        page: 1,
        x: 0.4,
        y: 0.4,
        width: 0.2,
        height: 0.07,
      },
      {
        id: "check",
        label: "Acknowledged",
        kind: "checkbox",
        required: true,
        page: 1,
        x: 0.8,
        y: 0.15,
        width: 0.03,
        height: 0.05,
      },
      {
        id: "choice",
        label: "Condition",
        kind: "select",
        options: ["Good", "Repair"],
        page: 1,
        x: 0.4,
        y: 0.15,
        width: 0.3,
        height: 0.07,
      },
    );
  const response = await request.post(shared + "/api/templates", {
    multipart: {
      title,
      reviewed: "true",
      definition_json: JSON.stringify(d),
      pdf: { name: "source.pdf", mimeType: "application/pdf", buffer: pdf() },
    },
  });
  expect(response.status()).toBe(200);
  return response.json();
}
async function photo(page: Page, text = "Visual reference") {
  const data = await page.evaluate((text) => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 400;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, 800, 400);
    context.fillStyle = "black";
    context.font = "48px Arial";
    context.fillText(text, 30, 80);
    return canvas.toDataURL("image/png").split(",")[1];
  }, text);
  return {
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
}
async function drag(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  x: number,
  y: number,
  toX: number,
  toY: number,
) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing draggable region");
  await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * toX, box.y + box.height * toY, {
    steps: 5,
  });
  await page.mouse.up();
}

test("custom editor all field types, formulas, layout, image annotations, reset, rename, downloads", async ({
  page,
  request,
}) => {
  const template = await createTemplate(request, "Checker all controls", true);
  const id = template.id;
  await page.goto(`/templates/custom/${id}/new`);
  for (const [label, value] of [
    ["Report title", "All controls"],
    ["Company", "Acme"],
    ["Date", "2026-10-14"],
    ["Temperature", "40"],
    ["Rated current", "80"],
    ["Notes", "Multiple\nlines of notes"],
    ["Visit time", "11:25"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("Acknowledged", { exact: true }).check();
  await page.getByLabel("Condition").selectOption("Repair");
  await expect(page.getByLabel("Load (calculated)")).toHaveValue("50%");
  await page
    .locator(".template-image-input input[type=file]")
    .setInputFiles(await photo(page));
  await expect(
    page.getByRole("button", { name: "Arrange layout", exact: true }),
  ).toHaveCount(0);
  const overlay = page.locator(".report-control-layer").first();
  await drag(page, overlay, 0.1, 0.16, 0.12, 0.17);

  await page
    .getByRole("button", { name: "Draw rectangle", exact: true })
    .click();
  await drag(
    page,
    page.locator(".report-control-layer").first(),
    0.6,
    0.28,
    0.8,
    0.42,
  );
  await page.getByLabel("Shape color", { exact: true }).evaluate((node) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, "#00ff00");
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  for (let i = 0; i < 4; i++)
    await page.getByLabel("Shape line width").press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Draw rectangle", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  if (
    await page
      .getByRole("button", { name: "Save draft only", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Save draft only", exact: true })
      .click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  const draftId = page.url().split("/").pop()!;
  let saved = await request.get(
    `${shared}/api/templates/${id}/drafts/${draftId}`,
  );
  const form = (await saved.json()).form;
  expect(form.layout.company.x).toBeGreaterThan(0.06);
  expect(form.rectangles[0].color).toBe("#00ff00");
  expect(form.rectangles[0].stroke_width).toBe(5);
  await page.reload();
  await expect(page.getByLabel("Visit time", { exact: true })).toHaveValue(
    "11:25",
  );
  await expect(
    page.getByRole("button", { name: "Arrange layout", exact: true }),
  ).toHaveCount(0);
  const region = page.locator(".report-control-layer").first();
  await region.scrollIntoViewIfNeeded();
  const bounds = await region.boundingBox();
  if (!bounds) throw new Error("Missing rectangle");
  await page.mouse.click(
    bounds.x + bounds.width * 0.7,
    bounds.y + bounds.height * 0.35,
  );
  await page.keyboard.press("Delete");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  saved = await request.get(`${shared}/api/templates/${id}/drafts/${draftId}`);
  expect((await saved.json()).form.rectangles).toHaveLength(0);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("button", { name: "Reset report", exact: true }).click();
  await expect(page.getByLabel("Report title", { exact: true })).toHaveValue(
    "",
  );
  await page.getByRole("link", { name: "Back to draft library" }).click();
  await page.getByRole("button", { name: "Rename All controls" }).click();
  await page.locator(".rename-inline input").fill("Renamed controls");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  for (const name of ["Download blank PDF"]) {
    const promise = page.waitForEvent("download");
    await page.getByRole("button", { name, exact: true }).click();
    expect((await promise).suggestedFilename()).toMatch(/\.(pdf|json)$/);
  }
});

test("custom required checkbox gets the same missing-field outline", async ({
  page,
  request,
}) => {
  const template = await createTemplate(request, "Checker checkbox", true);
  await page.goto(`/templates/custom/${template.id}/new`);
  const border = await page
    .locator(".template-checkbox-field")
    .evaluate((node) => getComputedStyle(node).borderTopColor);
  expect(border).toBe("rgb(239, 167, 173)");
});

test("OCR qualifier cannot cross into another photo label", async ({
  page,
}) => {
  test.fail(
    true,
    "QA-006: Bx1/Max incorrectly uses Bx2 Max 60 when Bx1 has only Min",
  );
  await page.goto("/");
  const value = await page.evaluate(async () => {
    const path = "/lib/template-ocr.ts";
    const ocr = await import(path);
    return ocr.extractQuotedReading("Bx1 Min 20 Bx2 Max 60", "Bx1", "Max");
  });
  expect(value).toBeNull();
});

test("template builder errors, properties, clearing, dropdowns, formulas, and review", async ({
  page,
}) => {
  await page.goto("/templates/new");
  const file = page.locator("input[type=file]").first();
  await file.setInputFiles({
    name: "not.xlsx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not pdf"),
  });
  await expect(page.getByRole("alert")).toContainText("Upload a PDF");
  await file.setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-broken"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await file.setInputFiles({
    name: "Properties.pdf",
    mimeType: "application/pdf",
    buffer: pdf(),
  });
  await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(
    "Properties",
  );
  await page
    .locator('[data-box-kind="field"]')
    .filter({ hasText: /^Company/ })
    .click();
  await page.getByLabel("Font", { exact: true }).selectOption("Helvetica");
  await page.getByLabel("Font size", { exact: true }).fill("18");
  await page.getByLabel("Font color", { exact: true }).evaluate((node) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, "#000082");
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByLabel("Alignment", { exact: true })).toHaveCount(0);
  await page.getByLabel("Include in missing-field reminders").uncheck();
  await expect(page.getByLabel("x (%)", { exact: true })).toHaveCount(0);
  await page.getByLabel("Cover original content in this field").uncheck();
  await page.getByLabel("Cover original content in this field").check();
  await page
    .locator('[data-box-kind="field"]')
    .filter({ hasText: /^Photograph/ })
    .click();
  await page.getByLabel("Image fitting").selectOption("cover");
  await page.getByRole("button", { name: "Input field", exact: true }).click();
  await drag(
    page,
    page.locator(".template-box-layer").nth(1),
    0.05,
    0.2,
    0.3,
    0.3,
  );
  await page.getByLabel("Field label", { exact: true }).fill("Choice");
  await page.getByLabel("Field type").selectOption("number");
  await page.getByRole("button", { name: "Cover box", exact: true }).click();
  await drag(
    page,
    page.locator(".template-box-layer").nth(1),
    0.05,
    0.05,
    0.25,
    0.09,
  );
  await page.getByRole("button", { name: "Delete selected box" }).click();
  await page
    .getByRole("button", { name: "View clean template", exact: true })
    .click();
  await expect(
    page.getByText("Clean template preview", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continue editing template", exact: true })
    .click();
  await expect(
    page.getByLabel("I reviewed the fields, covers, and extracted items."),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Properties is ready" }),
  ).toBeVisible();
});

test("mobile and tablet pages avoid horizontal overflow", async ({
  page,
  request,
}) => {
  const template = await createTemplate(request, "Checker responsive");
  for (const width of [390, 800]) {
    await page.setViewportSize({ width, height: 900 });
    for (const url of [
      "/",
      "/templates/new",
      `/templates/custom/${template.id}`,
      `/templates/custom/${template.id}/new`,
    ]) {
      await page.goto(url);
      await expect(page.locator("main")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        `${url} at ${width}px`,
      ).toBe(true);
    }
  }
});

test("custom template load and save errors are visible and recoverable", async ({
  page,
  request,
}) => {
  await page.goto("/templates/custom/not-a-template/new");
  await expect(page.getByRole("alert")).toContainText("Template not found");
  const template = await createTemplate(request, "Checker errors");
  await page.goto(`/templates/custom/${template.id}/new`);
  await page.getByLabel("Report title", { exact: true }).fill("Network error");
  await page.route("**/api/templates/*/drafts", (route) => route.abort());
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Cannot reach");
  await page.unroute("**/api/templates/*/drafts");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  await page.route("**/api/templates/*/preview", (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Preview validation test" }),
    }),
  );
  await page.getByLabel("Company", { exact: true }).fill("Updated");
  await expect(page.getByRole("alert")).toContainText(
    "Preview validation test",
  );
  await page.unroute("**/api/templates/*/preview");
  await page.getByLabel("Company", { exact: true }).fill("Recovered");
  await expect(page.locator(".template-paper")).toHaveCount(2);
});

test("raster-only PDF scan detects visible form boundaries locally", async ({
  page,
}) => {
  const scanned = python(
    "import sys;from io import BytesIO;from PIL import Image,ImageDraw;from reportlab.pdfgen import canvas;from reportlab.lib.utils import ImageReader;image=Image.new('RGB',(800,1000),'white');draw=ImageDraw.Draw(image);draw.rectangle((60,70,740,300),outline='black',width=3);draw.text((80,90),'Company:',fill='black');output=BytesIO();pdf=canvas.Canvas(output,pagesize=(400,500));pdf.drawImage(ImageReader(image),0,0,width=400,height=500);pdf.showPage();pdf.save();sys.stdout.buffer.write(output.getvalue())",
  );
  await page.goto("/templates/new");
  await page.locator("input[type=file]").first().setInputFiles({
    name: "scan.pdf",
    mimeType: "application/pdf",
    buffer: scanned,
  });
  await page
    .getByRole("button", {
      name: "Detect scanned page 1 with local OCR",
      exact: true,
    })
    .click();
  await expect(page.locator('[data-box-kind="field"]').first()).toBeVisible({
    timeout: 60000,
  });
  await page.locator('[data-box-kind="field"]').first().click();
  await expect(page.getByLabel("Field label", { exact: true })).not.toHaveValue(
    "",
  );
});

