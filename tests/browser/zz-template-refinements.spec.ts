import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { Page, APIRequestContext, Locator } from "@playwright/test";

const api = "http://127.0.0.1:8011/api/templates";
const python = (code: string) =>
  execFileSync(resolve("backend/.venv/bin/python"), ["-c", code], {
    cwd: resolve("backend"),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
async function seed(request: APIRequestContext, title: string, long = false) {
  const model = JSON.parse(
    python(
      "import runpy;print(runpy.run_path('tests/test_templates.py')['definition']().model_dump_json())",
    ).toString(),
  );
  model.ocr_mappings = [];
  model.fields.push({
    ...model.fields[3],
    id: "rated",
    label: "Rated current",
    x: 0.4,
  });
  model.fields.push({
    ...model.fields[3],
    id: "load",
    label: "Load",
    kind: "calculated",
    y: 0.42,
    calculation: { operation: "percentage", fields: ["temp", "rated"] },
  });
  if (long)
    for (let i = 0; i < 18; i++)
      model.fields.push({
        ...model.fields[3],
        id: `extra_${i}`,
        label: `Extra ${i}`,
        y: 0.55 + i * 0.02,
        height: 0.02,
      });
  model.fields.reverse();
  const response = await request.post(api, {
    multipart: {
      title,
      reviewed: "true",
      definition_json: JSON.stringify(model),
      pdf: {
        name: "form.pdf",
        mimeType: "application/pdf",
        buffer: python(
          "import runpy,sys;sys.stdout.buffer.write(runpy.run_path('tests/test_templates.py')['sample_pdf']())",
        ),
      },
    },
  });
  expect(response.status()).toBe(200);
  return await response.json();
}
async function drag(
  page: Page,
  target: Locator,
  start: [number, number],
  end: [number, number],
) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("Missing drag target");
  await page.mouse.move(
    box.x + box.width * start[0],
    box.y + box.height * start[1],
  );
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width * end[0],
    box.y + box.height * end[1],
    { steps: 5 },
  );
  await page.mouse.up();
}

test("builder supports native shortcuts, five allowed types, centered labels and dropdown calculations", async ({
  page,
  request,
}) => {
  const template = await seed(request, "Refined builder");
  await page.goto(`/templates/custom/${template.id}/edit`);
  await page
    .locator('[data-box-kind="field"]')
    .filter({ hasText: /^Temperature/ })
    .click();
  await expect(page.getByLabel("Field type", { exact: true })).toHaveValue(
    "number",
  );
  expect(
    await page
      .getByLabel("Field type", { exact: true })
      .locator("option")
      .allTextContents(),
  ).toEqual(["text", "number", "date", "image", "calculated"]);
  await expect(page.getByLabel("Draft-filter role")).toHaveCount(0);
  await expect(page.getByLabel("Alignment", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("width (%)")).toHaveCount(0);
  const text = page.locator('[data-box-id="temp"] text');
  await expect(text).toHaveAttribute("text-anchor", "middle");
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(page.getByLabel("Field label", { exact: true })).toHaveValue(
    "Temperature copy",
  );
  await page.keyboard.press("Control+z");
  await expect(
    page
      .locator('[data-box-kind="field"]')
      .filter({ hasText: /^Temperature copy/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Only view cover boxes", exact: true })
    .click();
  await page.locator('[data-box-kind="cover"] > rect').first().click();
  const covers = await page.locator('[data-box-kind="cover"]').count();
  await page.keyboard.press("Meta+c");
  await page.keyboard.press("Meta+v");
  await expect(page.locator('[data-box-kind="cover"]')).toHaveCount(covers + 1);
  await page
    .getByRole("button", { name: "Only view cover boxes", exact: true })
    .click();
  await page
    .locator('[data-box-kind="field"]')
    .filter({ hasText: /^Load/ })
    .click();
  await page.getByLabel("Calculation operator").selectOption("sum");
  await page.getByLabel("Number field 1", { exact: true }).selectOption("temp");
  await page
    .getByLabel("Number field 2", { exact: true })
    .selectOption("rated");
  await page.getByLabel("Calculation operator").selectOption("difference");
  await page.getByLabel("Number field 2", { exact: true }).selectOption("");
  await expect(page.locator(".calculation-errors")).toContainText("Load");
  await expect(
    page.getByLabel("Number field 2", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await page
    .getByLabel("Number field 2", { exact: true })
    .selectOption("rated");
  await expect(page.locator(".calculation-errors")).toHaveCount(0);
  await page.getByLabel("Calculation operator").selectOption("percentage");
  await expect(
    page.getByText("Numerator / denominator, displayed as a percentage."),
  ).toBeVisible();
  const ribbon = page.getByRole("toolbar", { name: "Template editing tools" });
  expect(
    await ribbon.evaluate((el) => !!el.closest(".template-preview-pane")),
  ).toBe(true);
  await page.screenshot({ path: "test-results/refined-builder.png" });
});

test("report sidebar follows PDF position and scrolls independently; resize, curved ticks and errors persist", async ({
  page,
  request,
}) => {
  const template = await seed(request, "Refined report", true),
    base = api + "/" + template.id;
  await page.goto(`/templates/custom/${template.id}/new`);
  await page.getByLabel("Report title", { exact: true }).fill("Ordered report");
  const labels = await page
    .locator(".template-sidebar > label > span")
    .allTextContents();
  expect(labels.indexOf("Company")).toBeLessThan(labels.indexOf("Date"));
  expect(labels.indexOf("Temperature")).toBeLessThan(
    labels.indexOf("Rated current"),
  );
  const preview = page.locator(".template-preview-pane");
  const before = await preview.boundingBox();
  await page
    .locator(".template-sidebar")
    .evaluate((el) => (el.scrollTop = 400));
  expect((await preview.boundingBox())!.y).toBe(before!.y);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByLabel("Temperature", { exact: true }).fill("30");
  await page.getByLabel("Rated current", { exact: true }).fill("0");
  await expect(page.locator(".calculation-errors")).toContainText(
    "Rated current (denominator) cannot be zero",
  );
  await expect(
    page.getByLabel("Rated current", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Rated current", { exact: true }).fill("60");
  await expect(page.locator(".calculation-errors")).toHaveCount(0);
  await expect(page.getByLabel("Load (calculated)")).toHaveCount(0);
  await expect(page.getByLabel("Rendered value: Load", { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Arrange layout", exact: true }),
  ).toHaveCount(0);
  const field = page.locator('[data-field-id="temp"]');
  await field.locator("rect").first().click();
  const width = Number(
    await field.locator("rect").first().getAttribute("width"),
  );
  await expect(field.locator("[data-resize-edge]")).toHaveCount(8);
  await drag(
    page,
    field.locator('[data-resize-edge="e"]'),
    [0.5, 0.5],
    [3, 0.5],
  );
  expect(
    Number(await field.locator("rect").first().getAttribute("width")),
  ).toBeGreaterThan(width);

  await page.getByRole("button", { name: "Insert tick", exact: true }).click();
  const shapeLayer = page.getByLabel("Report editing areas, page 2", {
    exact: true,
  });
  await drag(page, shapeLayer, [0.7, 0.2], [0.85, 0.35]);
  await page.getByLabel("Shape color", { exact: true }).evaluate((node) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, "#00aa00");
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(shapeLayer.locator(".report-shape-area > path")).toHaveAttribute(
    "fill",
    "#00aa00",
  );
  await expect(shapeLayer.locator(".report-shape-area > path")).toHaveAttribute(
    "d",
    / C /,
  );
  await expect(
    page.getByRole("button", { name: "Insert tick", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("button", { name: "Save draft only", exact: true })
    .click();
  await expect(page).toHaveURL(/\/drafts\//);
  const saved = await request.get(
    base + "/drafts/" + page.url().split("/").pop(),
  );
  const report = (await saved.json()).form;
  expect(report.layout.temp.width).toBeGreaterThan(width);
  expect(report.rectangles[0].color).toBe("#00aa00");
  const pdf = await request.post(base + "/generate", {
    multipart: { report_json: JSON.stringify(report) },
  });
  expect(pdf.status()).toBe(200);
  const greenPixels = execFileSync(
    resolve("backend/.venv/bin/python"),
    [
      "-c",
      "import sys,pypdfium2 as p;d=p.PdfDocument(sys.stdin.buffer.read());im=d[1].render(scale=2).to_pil().convert('RGB');print(sum(1 for r,g,b in im.getdata() if r<80 and g>100 and b<80))",
    ],
    {
      input: await pdf.body(),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  ).toString();
  expect(Number(greenPixels)).toBeGreaterThan(100);
  await page.screenshot({ path: "test-results/refined-report.png" });
});

test("archived template deletion has backup warning and cancel, then removes its reports", async ({
  page,
  request,
}) => {
  const template = await seed(request, "Permanent deletion UI"),
    base = api + "/" + template.id;
  const draft = await request.post(base + "/drafts", {
    multipart: { report_json: '{"title":"Previous record"}' },
  });
  const draftId = (await draft.json()).id;
  await page.goto("/");
  const card = page.locator(".template-card").filter({
    has: page.getByRole("heading", {
      name: "Permanent deletion UI",
      exact: true,
    }),
  });
  await expect(
    card.getByRole("link", { name: "Open template", exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole("link", { name: "Edit template", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete Permanent deletion UI", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Archive template", exact: true })
    .click();
  await page.getByLabel("Show archived templates").check();
  await page
    .getByRole("button", {
      name: "Permanently delete Permanent deletion UI",
      exact: true,
    })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Make a database backup first",
  );
  await expect(page.getByRole("alertdialog")).toContainText("cannot be undone");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await request.get(base + "/drafts/" + draftId)).status()).toBe(200);
  await page
    .getByRole("button", {
      name: "Permanently delete Permanent deletion UI",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  expect((await request.get(base + "/drafts/" + draftId)).status()).toBe(404);
});

