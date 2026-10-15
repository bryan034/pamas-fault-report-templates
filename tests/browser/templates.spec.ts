import { expect, test } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { Page, Locator } from "@playwright/test";

const api = "http://127.0.0.1:8011";
const pdf = () =>
  execFileSync(
    resolve("backend/.venv/bin/python"),
    [
      "-c",
      "import runpy,sys;sys.stdout.buffer.write(runpy.run_path('tests/test_templates.py')['sample_pdf']())",
    ],
    {
      cwd: resolve("backend"),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
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
    { steps: 6 },
  );
  await page.mouse.up();
}
async function photo(page: Page, value = "43.7") {
  const data = await page.evaluate((value) => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 400;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, 800, 400);
    context.fillStyle = "black";
    context.font = "64px Arial";
    context.fillText(value, 80, 110);
    return canvas.toDataURL("image/png").split(",")[1];
  }, value);
  return {
    name: "thermal.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
}

test("ribbon, resize edges, keyboard deletion and five-step undo, covers, image box and OCR chips", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/templates/new");
  await page.locator("input[type=file]").first().setInputFiles({
    name: "Inspection.pdf",
    mimeType: "application/pdf",
    buffer: pdf(),
  });
  await expect(
    page.getByRole("toolbar", { name: "Template editing tools" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Select / move" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Add extraction mapping" }),
  ).toHaveCount(0);
  const page2 = page.locator(".template-box-layer").nth(1);
  await page.getByRole("button", { name: "Cover box", exact: true }).click();
  await drag(page, page2, [0.05, 0.3], [0.4, 0.4]);
  await page.getByRole("button", { name: "Input field", exact: true }).click();
  await drag(page, page2, [0.08, 0.32], [0.35, 0.38]);
  await page.getByLabel("Field label", { exact: true }).fill("Temperature");
  await page.getByLabel("Field type").selectOption("number");
  await page.getByLabel("Font", { exact: true }).selectOption("Helvetica");
  await page.getByLabel("Font size", { exact: true }).fill("18");
  await page.getByLabel("Font color").evaluate((node) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, "#006600");
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const selectedRect = page2
    .locator('[data-box-kind="field"]')
    .last()
    .locator("rect")
    .first();
  const width = Number(await selectedRect.getAttribute("width"));
  const edge = page2.locator('[data-resize-edge="e"]');
  const box = await edge.boundingBox();
  if (!box) throw new Error("Missing edge handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(Number(await selectedRect.getAttribute("width"))).toBeGreaterThan(
    width,
  );
  await page
    .locator('[data-box-kind="field"]')
    .filter({ hasText: /^Temperature/ })
    .click();
  await page.keyboard.press("Delete");
  await expect(
    page.locator('[data-box-kind="field"]').filter({ hasText: /^Temperature/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(
    page.locator('[data-box-kind="field"]').filter({ hasText: /^Temperature/ }),
  ).toBeVisible();
  await page.keyboard.press("Control+Shift+z");
  await expect(
    page.locator('[data-box-kind="field"]').filter({ hasText: /^Temperature/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByRole("button", { name: "Only view cover boxes", exact: true })
    .click();
  await expect(page.locator('[data-box-kind="field"]')).toHaveCount(0);
  await expect(page.locator('[data-box-kind="cover"]').first()).toBeVisible();
  await page
    .getByRole("button", { name: "Only view cover boxes", exact: true })
    .click();
  await page.getByRole("button", { name: "Image box", exact: true }).click();
  await drag(page, page2, [0.5, 0.1], [0.8, 0.25]);
  await expect(page.getByLabel("Field type")).toHaveValue("image");
  await page.getByRole("button", { name: "Delete selected box" }).click();
  await page
    .locator('[data-box-kind="field"]')
    .filter({ hasText: /^Photograph/ })
    .click();
  await page.getByLabel("Field type").selectOption("image");
  await page
    .getByLabel("Sample photo for extraction")
    .setInputFiles(await photo(page));
  await page
    .getByRole("button", { name: "Extract data from image", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Extract data from image" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Extract data from image" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Extract data from image", exact: true })
    .click();
  await drag(
    page,
    page.locator(".extraction-image"),
    [0.05, 0.08],
    [0.5, 0.38],
  );
  await page.getByRole("button", { name: "Retake area" }).click();
  await expect(page.locator(".extraction-selection")).toHaveCount(0);
  await drag(
    page,
    page.locator(".extraction-image"),
    [0.05, 0.08],
    [0.5, 0.38],
  );
  await page.getByLabel("Area name").fill("Fault temperature");
  await page.getByRole("button", { name: "Create extracted item" }).click();
  await expect(page.locator(".extraction-chip")).toContainText("43.7", {
    timeout: 60000,
  });
  await page
    .locator('[data-box-kind="field"]')
    .filter({ hasText: /^Temperature/ })
    .click();
  await page
    .getByLabel("Extracted item", { exact: true })
    .selectOption({ label: "Fault temperature" });
  await page.getByLabel("Extracted item", { exact: true }).selectOption("");
  await page
    .locator(".extraction-chip")
    .dragTo(
      page2
        .locator('g[data-box-kind="field"]')
        .filter({ hasText: "Temperature" }),
    );
  await expect(
    page.getByLabel("Extracted item", { exact: true }),
  ).not.toHaveValue("");
  await page.getByRole("button", { name: "View clean template" }).click();
  await page.getByRole("button", { name: "Continue editing template" }).click();
  await expect(
    page.getByLabel("I reviewed the fields, covers, and extracted items."),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/template-builder.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Inspection is ready" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to editing" }).click();
  await page
    .getByLabel("Template name", { exact: true })
    .fill("Inspection revised");
  await expect(
    page.getByLabel("I reviewed the fields, covers, and extracted items."),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(
    page.getByText("Saved revision 2.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open template", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Edit template", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download template configuration" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "New report", exact: true }).click();
  await page.getByLabel("Report title", { exact: true }).fill("Panel A");
  await page
    .locator(".template-image-input input[type=file]")
    .setInputFiles(await photo(page, "55.2"));
  await expect(page.getByLabel("Temperature", { exact: true })).toHaveValue(
    "55.2",
    { timeout: 60000 },
  );
  await expect(page.getByLabel("I reviewed these photo readings.")).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Draw rectangle", exact: true })
    .click();
  await drag(
    page,
    page.locator(".report-control-layer").nth(1),
    [0.6, 0.5],
    [0.8, 0.6],
  );
  await expect(
    page.getByRole("button", { name: "Draw rectangle", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Insert tick", exact: true }).click();
  await drag(
    page,
    page.locator(".report-control-layer").nth(1),
    [0.3, 0.6],
    [0.36, 0.66],
  );
  await expect(
    page.getByRole("button", { name: "Insert tick", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  const url = page.url(),
    [, templateId, draftId] = url.match(/custom\/([^/]+)\/drafts\/([^/]+)/)!;
  const saved = await request.get(
    `${api}/api/templates/${templateId}/drafts/${draftId}`,
  );
  const form = (await saved.json()).form;
  expect(form.rectangles).toHaveLength(2);
  expect(form.rectangles[1].kind).toBe("tick");
  expect(
    form.rectangles.every((shape: { page: number }) => shape.page === 1),
  ).toBe(true);
  await page.reload();
  await expect(page.getByLabel("Temperature", { exact: true })).toHaveValue(
    "55.2",
  );
  await expect(page.locator(".template-paper")).toHaveCount(2);
  await page.screenshot({
    path: "test-results/template-editor.png",
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("Panel A.pdf");
  expect(errors).toEqual([]);
});

test("preview keeps its canvas while typing and does not repeat photo uploads", async ({
  page,
  request,
}) => {
  const model = JSON.parse(
    execFileSync(
      resolve("backend/.venv/bin/python"),
      [
        "-c",
        "import runpy;print(runpy.run_path('tests/test_templates.py')['definition']().model_dump_json())",
      ],
      {
        cwd: resolve("backend"),
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    ).toString(),
  );
  model.ocr_mappings = [];
  const result = await request.post(api + "/api/templates", {
    multipart: {
      title: "Preview test",
      reviewed: "true",
      definition_json: JSON.stringify(model),
      pdf: { name: "x.pdf", mimeType: "application/pdf", buffer: pdf() },
    },
  });
  const template = await result.json();
  await page.goto(`/templates/custom/${template.id}/new`);
  const imageUploaded = page.waitForResponse((response) =>
    response.url().endsWith("/preview-assets"),
  );
  const photoPreview = page.waitForResponse(
    (response) =>
      response.url().endsWith("/preview") &&
      !!response.request().postData()?.includes("asset_token"),
  );
  await page
    .locator(".template-image-input input[type=file]")
    .setInputFiles(await photo(page));
  await imageUploaded;
  await photoPreview;
  await expect(page.locator(".template-paper")).toHaveCount(2);
  await expect(page.locator(".template-pdf-pages")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  let repeatedUploads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/preview-assets")) repeatedUploads++;
  });
  await page.evaluate(() => {
    const state = window as Window & { previewRemoved?: boolean };
    state.previewRemoved = false;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.removedNodes)
          if (
            node instanceof Element &&
            (node.matches(".template-paper") ||
              node.querySelector(".template-paper"))
          )
            state.previewRemoved = true;
    }).observe(document.querySelector(".template-pdf-pages")!, {
      childList: true,
      subtree: true,
    });
  });
  const updated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/preview") &&
      !!response.request().postData()?.includes("Typing update"),
  );
  await page
    .getByLabel("Company", { exact: true })
    .pressSequentially("Typing update", { delay: 25 });
  const response = await updated;
  expect(response.ok()).toBe(true);
  const printed = execFileSync(
    resolve("backend/.venv/bin/python"),
    [
      "-c",
      "import sys;from io import BytesIO;from pypdf import PdfReader;print(PdfReader(BytesIO(sys.stdin.buffer.read())).pages[0].extract_text())",
    ],
    {
      cwd: resolve("backend"),
      input: Buffer.from((await response.json()).pdf, "base64"),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  ).toString();
  expect(printed).toContain("Typing update");
  await expect(page.locator(".template-pdf-pages")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(repeatedUploads).toBe(0);
  expect(
    await page.evaluate(
      () => (window as Window & { previewRemoved?: boolean }).previewRemoved,
    ),
  ).toBe(false);
});

test("library archives uploaded templates without deleting saved reports", async ({
  page,
  request,
}) => {
  const model = JSON.parse(
    execFileSync(
      resolve("backend/.venv/bin/python"),
      [
        "-c",
        "import runpy;print(runpy.run_path('tests/test_templates.py')['definition']().model_dump_json())",
      ],
      {
        cwd: resolve("backend"),
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    ).toString(),
  );
  const created = await request.post(api + "/api/templates", {
    multipart: {
      title: "Archive me",
      reviewed: "true",
      definition_json: JSON.stringify(model),
      pdf: { name: "x.pdf", mimeType: "application/pdf", buffer: pdf() },
    },
  });
  const template = await created.json();
  const saved = await request.post(
    `${api}/api/templates/${template.id}/drafts`,
    { multipart: { report_json: '{"title":"Keep this report"}' } },
  );
  const draft = await saved.json();
  await page.goto("/");
  await page
    .getByRole("button", { name: "Delete Archive me", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Archive template", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open Archive me", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Show archived templates").check();
  await expect(
    page.getByRole("link", { name: "Open Archive me", exact: true }),
  ).toBeVisible();
  expect(
    (
      await request.get(
        `${api}/api/templates/${template.id}/drafts/${draft.id}`,
      )
    ).status(),
  ).toBe(200);
  await page
    .getByRole("button", { name: "Recover Archive me", exact: true })
    .click();
  await page.getByLabel("Show archived templates").uncheck();
  await expect(
    page.getByRole("link", { name: "Open Archive me", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('a[href="/templates/fault-report"]'),
  ).toHaveCount(0);
});
