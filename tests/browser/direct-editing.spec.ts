import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { APIRequestContext, Page, Locator } from "@playwright/test";
const api = "http://127.0.0.1:8011/api/templates";
const python = (code: string) =>
  execFileSync(resolve("backend/.venv/bin/python"), ["-c", code], {
    cwd: resolve("backend"),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
async function seed(request: APIRequestContext) {
  const definition = JSON.parse(
    python(
      "import runpy;print(runpy.run_path('tests/test_templates.py')['definition']().model_dump_json())",
    ).toString(),
  );
  definition.ocr_mappings = [];
  // Put the first input below the fold in the sidebar, but on PDF page one.
  for (let i = 0; i < 12; i++)
    definition.fields.push({
      ...definition.fields[0],
      id: `extra_${i}`,
      label: `Extra field ${i}`,
      page: 0,
      y: 0.01 + i * 0.004,
      x: 0.01,
      width: 0.025,
      height: 0.003,
      role: null,
    });
  const response = await request.post(api, {
    multipart: {
      title: "Direct interaction test",
      definition_json: JSON.stringify(definition),
      pdf: {
        name: "Form.pdf",
        mimeType: "application/pdf",
        buffer: python(
          "import runpy,sys;sys.stdout.buffer.write(runpy.run_path('tests/test_templates.py')['sample_pdf']())",
        ),
      },
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function draw(
  page: Page,
  layer: Locator,
  start: [number, number],
  end: [number, number],
) {
  await layer.scrollIntoViewIfNeeded();
  const b = (await layer.boundingBox())!;
  await page.mouse.move(b.x + b.width * start[0], b.y + b.height * start[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * end[0], b.y + b.height * end[1], {
    steps: 5,
  });
  await page.mouse.up();
}
async function contained(dialog: Locator) {
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect
    .poll(() =>
      dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.x >= 8 && r.right <= window.innerWidth - 8;
      }),
    )
    .toBe(true);
  const box = (await dialog.boundingBox())!;
  for (const child of await dialog
    .locator(
      '[data-slot="alert-dialog-title"],[data-slot="alert-dialog-description"],button',
    )
    .all()) {
    const b = (await child.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(box.x);
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height + 1);
  }
}

test("new input automatically covers source content, focuses its name and Enter finishes naming", async ({page, request}) => {
  const template = await seed(request);
  await page.goto(`/templates/custom/${template.id}/edit`);
  const layer = page.getByLabel("Template field review, page 1", { exact: true });
  await expect(layer).toBeVisible();
  const initialIds = await layer.locator('[data-box-kind="field"]').evaluateAll(
    elements => elements.map(el => el.getAttribute("data-box-id")),
  );
  await page.getByRole("button", { name: "Input field", exact: true }).click();
  await draw(page, layer, [.1, .1], [.4, .16]);
  const label = page.getByLabel("Field label", { exact: true });
  await expect(label).toBeFocused();
  // No extra click: the placeholder label is selected, ready to replace.
  await page.keyboard.type("New equipment name");
  await expect(label).toHaveValue("New equipment name");
  await page.keyboard.press("Enter");
  await expect(label).not.toBeFocused();
  const id = await layer.locator('[data-box-kind="field"]').evaluateAll(
    (elements, oldIds) => elements.map(el => el.getAttribute("data-box-id")).find(id => !oldIds.includes(id)), initialIds,
  );
  expect(id).toBeTruthy();
  const input = layer.locator(`[data-box-kind="field"][data-box-id="${id}"]`);
  const cover = layer.locator(`[data-box-kind="cover"][data-box-id="${id}"]`);
  await expect(cover).toHaveCount(1);
  await expect(cover.locator(":scope > rect").first()).toHaveAttribute("fill", "#ffffff");
  const coverBounds = await cover.locator(":scope > rect").first().evaluate(node =>
    Object.fromEntries(["x","y","width","height"].map(key => [key,node.getAttribute(key)])));
  const unchangedCover = async () => {
    for (const [key,value] of Object.entries(coverBounds))
      await expect(cover.locator(":scope > rect").first()).toHaveAttribute(key,value!);
  };
  // Input resizing leaves the independently sized background cover unchanged.
  const handle = input.locator('[data-resize-edge="se"]');
  await handle.scrollIntoViewIfNeeded();
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 24, bounds.y + 15, {steps: 3});
  await page.mouse.up();
  await unchangedCover();
  const review = page.waitForResponse(r => r.url().endsWith("/api/templates/review") && r.request().method() === "POST");
  await page.getByRole("button", {name: "View clean template", exact: true}).click();
  expect((await review).ok()).toBe(true);
  await page.getByRole("button", {name: "Continue editing template", exact: true}).click();
  await input.locator(":scope > rect").first().click();
  await layer.focus();
  await page.keyboard.press("Delete");
  await expect(input).toHaveCount(0);
  await expect(cover).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await unchangedCover();
  const savedResponse = page.waitForResponse(r => r.url() === `${api}/${template.id}` && r.request().method() === "PUT");
  await page.getByRole("button", {name: "Save template", exact: true}).click();
  const response = await savedResponse;
  expect(response.ok()).toBe(true);
  const saved = await response.json();
  const savedField = saved.definition.fields.find((field: {id: string}) => field.id === id);
  const savedCover = saved.definition.clear_areas.find((area: {id: string}) => area.id === id);
  expect(savedField.label).toBe("New equipment name");
  for (const attribute of ["x", "y", "width", "height"])
    expect(savedCover[attribute]).toBe(Number(coverBounds[attribute]));
  expect(savedField.width).toBeGreaterThan(savedCover.width);
});

test("Ctrl-click selects a group, pastes attached covers and gives new image boxes covers", async ({page, request}) => {
  const template = await seed(request);
  await page.goto(`/templates/custom/${template.id}/edit`);
  const layer = page.getByLabel("Template field review, page 1", {exact: true});
  await expect(layer.locator('[data-box-id="company"][data-box-kind="field"]')).toBeVisible();
  const initialFields = await layer.locator('[data-box-kind="field"]').count();
  const initialCovers = await layer.locator('[data-box-kind="cover"]').count();
  await layer.locator('[data-box-id="company"][data-box-kind="field"] > rect').first().click();
  await layer.locator('[data-box-id="photo"][data-box-kind="field"] > rect').first().click({modifiers: ["Control"]});
  await expect(layer.locator('[data-selected="true"]')).toHaveCount(2);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(layer.locator('[data-box-kind="field"]')).toHaveCount(initialFields + 2);
  await expect(layer.locator('[data-box-kind="cover"]')).toHaveCount(initialCovers + 2);
  const copiedIds = await layer.locator('[data-box-kind="field"][data-selected="true"]').evaluateAll(
    nodes => nodes.map(node => node.getAttribute("data-box-id")!),
  );
  const coverGeometry = () => layer.locator('[data-box-kind="cover"] > rect').evaluateAll(nodes =>
    nodes.map(node => ["x","y","width","height","fill"].map(key => node.getAttribute(key))));
  const originalCovers = await coverGeometry();
  const checkCovers = async () => expect(await coverGeometry()).toEqual(originalCovers);
  await page.keyboard.press("ArrowRight");
  await checkCovers();
  const photo = layer.locator(`[data-box-kind="field"][data-box-id="${copiedIds[1]}"] > rect`).first();
  await draw(page, photo, [.5, .5], [.6, .6]);
  await checkCovers();
  await layer.focus();
  await page.keyboard.press("Delete");
  await expect(layer.locator('[data-box-kind="field"]')).toHaveCount(initialFields);
  await expect(layer.locator('[data-box-kind="cover"]')).toHaveCount(initialCovers + 2);
  await page.keyboard.press("Control+z");
  await checkCovers();
  await page.getByRole("button", {name: "Image box", exact: true}).click();
  await draw(page, layer, [.12, .6], [.4, .8]);
  const label = page.getByLabel("Field label", {exact: true});
  await expect(label).toBeFocused();
  await page.keyboard.type("New photo");
  await page.keyboard.press("Enter");
  const image = layer.locator('[data-box-kind="field"]').filter({hasText: "New photo"});
  const id = await image.getAttribute("data-box-id");
  const cover = layer.locator(`[data-box-kind="cover"][data-box-id="${id}"] > rect`).first();
  await expect(cover).toHaveAttribute("fill", "#ffffff");
  for (const key of ["x", "y", "width", "height"])
    expect(await cover.getAttribute(key)).toBe(await image.locator(":scope > rect").first().getAttribute(key));
});

test("saving a template shows success and opens its report library", async ({page, request}) => {
  const template = await seed(request);
  await page.goto(`/templates/custom/${template.id}/edit`);
  await page.locator('[data-box-id="company"][data-box-kind="field"] > rect').first().click();
  const alignment = page.getByLabel("Template text alignment", {exact: true});
  const toolbarAlignment = page.getByRole("toolbar", {name: "Template editing tools"})
    .getByLabel("Selected field alignment", {exact: true});
  await toolbarAlignment.selectOption("left");
  await expect(alignment).toHaveValue("left");
  await expect(page.locator('[data-template-label="company"] > text')).toHaveAttribute("text-anchor", "middle");
  await page.locator('[data-box-id="photo"][data-box-kind="field"] > rect').first().click();
  await expect(toolbarAlignment).toBeDisabled();
  await page.locator('[data-box-id="date"][data-box-kind="field"] > rect').first().click();
  await expect(toolbarAlignment).toHaveValue("center");
  await page.locator('[data-box-id="company"][data-box-kind="field"] > rect').first().click();
  await expect(toolbarAlignment).toHaveValue("left");
  await alignment.selectOption("right");
  await expect(toolbarAlignment).toHaveValue("right");
  await expect(page.locator('[data-template-label="company"] > text')).toHaveAttribute("text-anchor", "middle");
  await page.getByLabel("Default value for new reports").fill("Aligned default");
  await expect(page.locator('[data-template-default="company"] > text')).toHaveAttribute("text-anchor", "middle");
  await page.getByRole("button", {name: "Save template", exact: true}).click();
  await expect(page.getByRole("alertdialog")).toContainText("Template saved successfully");
  await expect(page).toHaveURL(new RegExp(`/templates/custom/${template.id}$`));
  await expect(page.getByRole("link", {name: "New report", exact: true})).toBeVisible();
  const saved = await (await request.get(`${api}/${template.id}`)).json();
  expect(saved.definition.fields.find((field: {id: string}) => field.id === "company").alignment).toBe("right");
  await page.getByRole("link", {name: "New report", exact: true}).click();
  await page.getByLabel("Company", {exact: true}).click();
  await expect(page.getByLabel("Report text alignment")).toHaveValue("right");
});

test("report toolbar is one compact sticky row and report exports only offer PDF and Word", async ({page, request}) => {
  const template = await seed(request);
  await page.goto(`/templates/custom/${template.id}/new`);
  await expect(page.getByText("Live PDF preview", {exact: true})).toHaveCount(0);
  await expect(page.getByRole("button", {name: /Download original format/})).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Download PDF", exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "Download Word", exact: true})).toBeVisible();
  const tools = page.locator(".report-preview-tools");
  await expect(tools).toHaveCSS("position", "sticky");
  await page.screenshot({path: "test-results/compact-report-toolbar.png"});
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({width, height: 1100});
    await expect.poll(async () => (await tools.boundingBox())!.height).toBeLessThanOrEqual(55);
    const heights = await tools.locator("button,label").evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("builder removes field list, promotes selected settings, isolates extraction and trial typing", async ({
  page,
  request,
}) => {
  const template = await seed(request);
  await page.goto(`/templates/custom/${template.id}/edit`);
  await expect(page.locator(".template-field-list")).toHaveCount(0);
  await page
    .locator('[data-box-id="company"][data-box-kind="field"] > rect')
    .first()
    .click();
  await expect(page.getByLabel("Field label", { exact: true })).toHaveValue(
    "Company",
  );
  expect(
    await page
      .locator(".template-properties")
      .evaluate((el) =>
        el.previousElementSibling?.classList.contains("preview-report-flow"),
      ),
  ).toBe(true);
  await expect(
    page.getByRole("region", { name: "Extract Data from Image", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View clean template", exact: true })
    .click();
  const resume = page.getByRole("button", {
    name: "Continue editing template",
    exact: true,
  });
  await expect(resume).toHaveClass(/bg-primary/);
  await resume.click();
  await page
    .getByRole("button", { name: "Preview report creation flow", exact: true })
    .click();
  await page.locator('[data-field-id="company"] .report-field-hit').click();
  await page
    .getByLabel("Edit Company in preview", { exact: true })
    .fill("Unsaved inline trial");
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Unsaved inline trial",
  );
  await page
    .getByRole("button", { name: "Continue editing", exact: true })
    .click();
  expect(
    (await (await request.get(api + `/${template.id}/drafts`)).json()).drafts,
  ).toEqual([]);
});

test("saved report supports inline typing, sidebar reveal/glow, deselection, one-shot rectangles and responsive resizing", async ({
  page,
  request,
}) => {
  const template = await seed(request),
    base = api + `/${template.id}`;
  const draft = await (
    await request.post(base + "/drafts", {
      multipart: { report_json: '{"title":"Inline existing"}' },
    })
  ).json();
  await page.goto(`/templates/custom/${template.id}/drafts/${draft.id}`);
  await page.locator('[data-field-id="company"] .report-field-hit').click();
  const input = page.getByLabel("Edit Company in preview", { exact: true });
  await input.fill("Inline company");
  const sidebar = page.locator(".template-sidebar"),
    field = page.locator('[data-sidebar-field="company"]');
  await expect(field).toHaveAttribute("data-preview-active", "true");
  await expect
    .poll(() => sidebar.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Inline company",
  );
  await page
    .locator(".template-preview-pane")
    .click({ position: { x: 5, y: 5 } });
  await expect(input).toHaveCount(0);
  await expect(page.locator(".report-field-area.selected")).toHaveCount(0);
  await expect(field).not.toHaveAttribute("data-preview-active", "true");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  expect(
    (await (await request.get(base + `/drafts/${draft.id}`)).json()).form.values
      .company,
  ).toBe("Inline company");
  await page
    .getByRole("button", { name: "Draw rectangle", exact: true })
    .click();
  const layer = page.getByLabel("Report editing areas, page 1", {
    exact: true,
  });
  await draw(page, layer, [0.65, 0.75], [0.85, 0.85]);
  await expect(
    page.getByRole("button", { name: "Draw rectangle", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-shape-id]")).toHaveCount(1);
  await draw(page, layer, [0.55, 0.7], [0.6, 0.74]);
  await expect(page.locator("[data-shape-id]")).toHaveCount(1);
  await expect(page.locator(".report-shape-area.selected")).toHaveCount(0);
  const separator = page.getByRole("separator", {
    name: "Resize report sidebar",
  });
  await separator.focus();
  for (let i = 0; i < 12; i++) await separator.press("ArrowRight");
  expect((await sidebar.boundingBox())!.width).toBeGreaterThan(550);
  const beforeResize = (await sidebar.boundingBox())!.width,
    grip = (await separator.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 100);
  await page.mouse.down();
  await page.mouse.move(grip.x + 80, grip.y + 100, { steps: 5 });
  await page.mouse.up();
  expect((await sidebar.boundingBox())!.width).toBeGreaterThan(
    beforeResize + 50,
  );
  const a = (await page
      .locator('[data-sidebar-field="extra_0"]')
      .boundingBox())!,
    b = (await page.locator('[data-sidebar-field="extra_1"]').boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(b.x).toBeGreaterThan(a.x);
  await page.screenshot({ path: "test-results/inline-report-sidebar.png" });
});

test("missing title blocks saving and future-configuration dialog keeps all content inside at desktop/mobile widths", async ({
  page,
  request,
}) => {
  const template = await seed(request);
  await page.goto(`/templates/custom/${template.id}/new`);
  const save = page.getByRole("button", { name: "Save draft", exact: true });
  await expect(save).toHaveClass(/save-title-missing/);
  await save.click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "A report title needs to be added",
  );
  expect(
    (await (await request.get(api + `/${template.id}/drafts`)).json()).drafts,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Add report title", exact: true })
    .click();
  await page
    .getByLabel("Report title", { exact: true })
    .fill("Configuration popup");
  await expect(save).toHaveClass(/bg-primary/);
  await page.getByLabel("Company", { exact: true }).focus();
  await page.getByLabel("Report font size", { exact: true }).selectOption("12");
  await save.click();
  const dialog = page.getByRole("alertdialog");
  await contained(dialog);
  await page.screenshot({
    path: "test-results/configuration-dialog-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await contained(dialog);
  await page.screenshot({
    path: "test-results/configuration-dialog-mobile.png",
  });
  await page
    .getByRole("button", { name: "Save draft only", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
});
