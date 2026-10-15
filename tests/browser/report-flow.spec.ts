import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { Page, Locator, APIRequestContext } from "@playwright/test";
const api = "http://127.0.0.1:8011";
const python = (code: string) =>
  execFileSync(resolve("backend/.venv/bin/python"), ["-c", code], {
    cwd: resolve("backend"),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
const source = () =>
  python(
    "import runpy,sys;sys.stdout.buffer.write(runpy.run_path('tests/test_templates.py')['sample_pdf']())",
  );
async function seed(
  request: APIRequestContext,
  title: string,
  style: Record<string, string | number> = {},
) {
  const model = JSON.parse(
    python(
      "import runpy;print(runpy.run_path('tests/test_templates.py')['definition']().model_dump_json())",
    ).toString(),
  );
  model.ocr_mappings = [];
  Object.assign(model.fields[0], style);
  const result = await request.post(api + "/api/templates", {
    multipart: {
      title,
      definition_json: JSON.stringify(model),
      pdf: { name: "Form.pdf", mimeType: "application/pdf", buffer: source() },
    },
  });
  expect(result.status()).toBe(200);
  return result.json();
}
async function drag(
  page: Page,
  target: Locator,
  start: [number, number],
  end: [number, number],
) {
  await target.scrollIntoViewIfNeeded();
  const b = await target.boundingBox();
  if (!b) throw new Error("Missing drag target");
  await page.mouse.move(b.x + b.width * start[0], b.y + b.height * start[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * end[0], b.y + b.height * end[1], {
    steps: 5,
  });
  await page.mouse.up();
}
async function photo(page: Page) {
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 400;
    const x = c.getContext("2d")!;
    x.fillStyle = "white";
    x.fillRect(0, 0, 800, 400);
    x.fillStyle = "black";
    x.font = "64px Arial";
    x.fillText("43.7", 80, 110);
    return c.toDataURL("image/png").split(",")[1];
  });
  return {
    name: "extraction-sample.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
}

test("unsaved report creation trial accepts values without creating templates or drafts", async ({
  page,
  request,
}) => {
  const before = (await (await request.get(api + "/api/templates")).json())
    .templates.length;
  await page.goto("/templates/new");
  await page.locator("input[type=file]").first().setInputFiles({
    name: "Unsaved flow.pdf",
    mimeType: "application/pdf",
    buffer: source(),
  });
  await expect(
    page.getByLabel("I reviewed the fields, covers, and extracted items."),
  ).toHaveCount(0);
  const only = page.getByRole("button", {
      name: "Only view cover boxes",
      exact: true,
    }),
    clean = page.getByRole("button", {
      name: "View clean template",
      exact: true,
    });
  expect(
    await only.evaluate((el) =>
      el.parentElement?.classList.contains("sidebar-view-actions"),
    ),
  ).toBe(true);
  await expect(clean).toBeVisible();
  await page
    .getByRole("button", { name: "Preview report creation flow", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Continue editing", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Report title", { exact: true }).fill("Trial job");
  await page.getByLabel("Company", { exact: true }).fill("Never store this");
  await expect(
    page.getByLabel("Rendered value: Company", { exact: true }),
  ).toHaveCount(1);
  expect(
    (await (await request.get(api + "/api/templates")).json()).templates.length,
  ).toBe(before);
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Continue editing", exact: true })
    .click();
  await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(
    "Unsaved flow",
  );
  await page
    .getByRole("button", { name: "Only view cover boxes", exact: true })
    .click();
  await expect(page.locator(".template-field-list")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unsaved flow is ready" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to editing", exact: true }),
  ).toHaveClass(/border/);
});

test("field content follows hover dragging before release; fonts, one-shot ticks, deletion and future defaults", async ({
  page,
  request,
}) => {
  const template = await seed(request, "Interactive report flow"),
    base = api + "/api/templates/" + template.id;
  await page.goto(`/templates/custom/${template.id}/new`);
  await page.getByLabel("Report title", { exact: true }).fill("Live job");
  await page.getByLabel("Company", { exact: true }).fill("Acme live");
  const value = page.locator('[data-live-field="company"]');
  await expect(value).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Arrange layout", exact: true }),
  ).toHaveCount(0);
  const field = page.locator('[data-field-id="company"]');
  await field.locator(".report-field-hit").hover();
  await expect(field.locator('[data-resize-edge="e"]')).toBeVisible();
  const before = (await value.boundingBox())!,
    hit = (await field.locator(".report-field-hit").boundingBox())!;
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    hit.x + hit.width / 2 + 25,
    hit.y + hit.height / 2 + 12,
    { steps: 5 },
  );
  expect((await value.boundingBox())!.x).toBeGreaterThan(before.x + 15);
  await page.mouse.up();
  await page
    .getByLabel("Report font", { exact: true })
    .selectOption("Helvetica-Bold");
  await page.getByLabel("Report font size", { exact: true }).fill("12");
  await page
    .getByLabel("Report font color", { exact: true })
    .evaluate((node) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(node, "#006600");
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await page.getByRole("button", { name: "Insert tick", exact: true }).click();
  const layer = page.getByLabel("Report editing areas, page 1", {
    exact: true,
  });
  await drag(page, layer, [0.6, 0.72], [0.7, 0.82]);
  await expect(
    page.getByRole("button", { name: "Insert tick", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-shape-id]")).toHaveCount(1);
  await drag(page, layer, [0.8, 0.75], [0.85, 0.8]);
  await expect(page.locator("[data-shape-id]")).toHaveCount(1);
  const shape = page.locator("[data-shape-id]");
  await shape.locator(".report-shape-hit").hover();
  await expect(
    shape.getByRole("button", { name: /Delete tick/ }),
  ).toBeVisible();
  await shape.getByRole("button", { name: /Delete tick/ }).click();
  await expect(shape).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Current report values",
  );
  await page
    .getByRole("button", { name: "Save draft only", exact: true })
    .click();
  await expect(page).toHaveURL(/\/drafts\//);
  const draftId = page.url().split("/").pop()!;
  const saved = (await (await request.get(base + "/drafts/" + draftId)).json())
    .form;
  expect(saved.styles.company.font).toBe("Helvetica-Bold");
  expect(saved.styles.company.color).toBe("#006600");
  expect(saved.values.company).toBe("Acme live");
  await page
    .getByLabel("Format report field", { exact: true })
    .selectOption("company");
  await page.getByLabel("Report font size", { exact: true }).fill("14");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const future = page.waitForRequest((req) =>
    req.url().endsWith("/report-defaults"),
  );
  await page
    .getByRole("button", {
      name: "Save draft and future configuration",
      exact: true,
    })
    .click();
  expect(Object.keys((await future).postDataJSON()).sort()).toEqual([
    "expected_revision_id",
    "font_sizes",
    "layout",
  ]);
  await expect(page.getByRole("status")).toContainText("Draft saved");
  const current = await (await request.get(base)).json();
  expect(current.definition.fields[0].font_size).toBe(14);
  expect(current.definition.fields[0].font).toBe("Times-Roman");
  await page.goto(`/templates/custom/${template.id}/new`);
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue("");
  await page.getByLabel("Format report field").selectOption("company");
  await expect(
    page.getByLabel("Report font size", { exact: true }),
  ).toHaveValue("14");
  await page.screenshot({ path: "test-results/report-hover-flow.png" });
});

test("nullable saved style overrides inherit template fonts and never publish null font sizes", async ({
  page,
  request,
}) => {
  const template = await seed(request, "Inherited report style", {
    font: "Helvetica-Bold",
    font_size: 20,
    color: "#006600",
  });
  const base = api + "/api/templates/" + template.id;
  const draft = await (
    await request.post(base + "/drafts", {
      multipart: {
        report_json: JSON.stringify({
          title: "Inherited job",
          values: { company: "Example" },
          styles: { company: { color: "#007700" } },
        }),
      },
    })
  ).json();
  expect(draft.form.styles.company.font_size).toBeNull();
  await page.goto(`/templates/custom/${template.id}/drafts/${draft.id}`);
  await page
    .getByLabel("Format report field", { exact: true })
    .selectOption("company");
  await expect(page.getByLabel("Report font", { exact: true })).toHaveValue(
    "Helvetica-Bold",
  );
  await expect(
    page.getByLabel("Report font size", { exact: true }),
  ).toHaveValue("20");
  await expect(
    page.getByLabel("Report font color", { exact: true }),
  ).toHaveValue("#007700");
  await page.getByLabel("Report font", { exact: true }).selectOption("Courier");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await drag(
    page,
    page.locator('[data-field-id="company"] .report-field-hit'),
    [0.4, 0.4],
    [0.5, 0.5],
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const future = page.waitForRequest((req) =>
    req.url().endsWith("/report-defaults"),
  );
  await page
    .getByRole("button", {
      name: "Save draft and future configuration",
      exact: true,
    })
    .click();
  expect((await future).postDataJSON().font_sizes).toEqual({});
  await expect(page.getByRole("status")).toContainText("Draft saved");
  expect(
    (await (await request.get(base)).json()).definition.fields[0].font_size,
  ).toBe(20);
});

test("sample photo and extracted chips remain visible, show unlinked red state and linked field label", async ({
  page,
  request,
}) => {
  const template = await seed(request, "Image extraction flow");
  await page.goto(`/templates/custom/${template.id}/edit`);
  await expect(
    page.getByText("Choose image for value extraction", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Sample photo for extraction", { exact: false })
    .setInputFiles(await photo(page));
  await expect(
    page.getByAltText("Sample photo: extraction-sample.png"),
  ).toBeVisible();
  await expect(
    page.getByText("extraction-sample.png", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Extract data from image", exact: true })
    .click();
  const close = page.getByRole("button", {
      name: "Cancel extraction",
      exact: true,
    }),
    retake = page.getByRole("button", { name: "Retake area", exact: true });
  expect(await close.evaluate((el) => getComputedStyle(el).color)).not.toBe(
    "rgb(255, 255, 255)",
  );
  await expect(retake).toBeVisible();
  await drag(
    page,
    page.locator(".extraction-image"),
    [0.05, 0.08],
    [0.5, 0.38],
  );
  await page.getByLabel("Area name").fill("Measured reading");
  await page
    .getByRole("button", { name: "Create extracted item", exact: true })
    .click();
  const chip = page.locator(".extraction-chip");
  await expect(chip).toContainText("43.7", { timeout: 60000 });
  await expect(chip).toHaveClass(/is-unlinked/);
  await expect(
    page.getByRole("heading", {
      name: "Extracted Data from Image",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".extraction-drag-instruction em")).toContainText(
    "drag and drop",
  );
  await page
    .locator('[data-box-kind="field"]')
    .filter({ hasText: /^Company/ })
    .click();
  await page
    .getByLabel("Extracted item", { exact: true })
    .selectOption({ label: "Measured reading" });
  await expect(chip).not.toHaveClass(/is-unlinked/);
  await expect(chip).toContainText("Linked to Company");
  await page.screenshot({ path: "test-results/extraction-flow.png" });
});

test("draft library exposes Edit draft and direct titled PDF download between rename/delete", async ({
  page,
  request,
}) => {
  const template = await seed(request, "Draft action flow"),
    base = api + "/api/templates/" + template.id;
  await request.post(base + "/drafts", {
    multipart: {
      report_json: '{"title":"Downloadable job","values":{"company":"Acme"}}',
    },
  });
  await page.goto(`/templates/custom/${template.id}`);
  await expect(
    page.getByRole("link", { name: "Edit draft", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Edit template", exact: true }),
  ).toHaveClass(/bg-primary/);
  const rename = page.getByRole("button", {
      name: "Rename Downloadable job",
      exact: true,
    }),
    download = page.getByRole("button", {
      name: "Download Downloadable job",
      exact: true,
    }),
    remove = page.getByRole("button", {
      name: "Delete Downloadable job",
      exact: true,
    });
  expect((await download.boundingBox())!.x).toBeGreaterThan(
    (await rename.boundingBox())!.x,
  );
  expect((await download.boundingBox())!.x).toBeLessThan(
    (await remove.boundingBox())!.x,
  );
  const promise = page.waitForEvent("download");
  await download.click();
  expect((await promise).suggestedFilename()).toBe("Downloadable job.pdf");
});
