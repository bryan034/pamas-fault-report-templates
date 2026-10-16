import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async function draw(page: Page, layer: Locator, start: [number, number], end: [number, number]) {
  await layer.scrollIntoViewIfNeeded();
  const box = (await layer.boundingBox())!;
  await page.mouse.move(box.x + box.width * start[0], box.y + box.height * start[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * end[0], box.y + box.height * end[1], { steps: 5 });
  await page.mouse.up();
}

for (const fallback of [false, true]) {
  test(`editor creates fields, copies and shapes with ${fallback ? "HTTP LAN fallback" : "native secure-context UUIDs"}`, async ({ page }) => {
    if (fallback) {
      await page.addInitScript(() => {
        Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
      });
    }
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const pdf = execFileSync(resolve("backend/.venv/bin/python"), ["-c",
      "import runpy,sys;sys.stdout.buffer.write(runpy.run_path('tests/test_templates.py')['sample_pdf']())",
    ], { cwd: resolve("backend"), env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    await page.goto("/templates/new");
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe(fallback ? "undefined" : "function");
    await page.locator("input[type=file]").first().setInputFiles({ name: "LAN test.pdf", mimeType: "application/pdf", buffer: pdf });
    const layer = page.locator(".template-box-layer").nth(1);
    await expect(layer).toBeVisible();

    await page.getByRole("button", { name: "Cover box", exact: true }).click();
    await draw(page, layer, [0.05, 0.3], [0.4, 0.4]);
    const covers = layer.locator('[data-box-kind="cover"]');
    await expect(covers).toHaveCount(1);
    expect(await covers.first().getAttribute("data-box-id")).toMatch(uuidV4);

    const fields = layer.locator('[data-box-kind="field"]');
    const before = await fields.count();
    await page.getByRole("button", { name: "Input field", exact: true }).click();
    await draw(page, layer, [0.08, 0.32], [0.35, 0.38]);
    await expect(fields).toHaveCount(before + 1);
    const originalId = await fields.last().getAttribute("data-box-id");
    expect(originalId).toMatch(uuidV4);
    await fields.last().locator("rect").first().click();
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await expect(fields).toHaveCount(before + 2);
    const copiedId = await fields.last().getAttribute("data-box-id");
    expect(copiedId).toMatch(uuidV4);
    expect(copiedId).not.toBe(originalId);

    await page.getByRole("button", { name: "Image box", exact: true }).click();
    await draw(page, layer, [0.55, 0.5], [0.85, 0.7]);
    await expect(page.getByLabel("Field type", { exact: true })).toHaveValue("image");
    expect(await fields.last().getAttribute("data-box-id")).toMatch(uuidV4);

    await page.getByRole("button", { name: "Preview report creation flow", exact: true }).click();
    const reportLayer = page.getByLabel("Report editing areas, page 1", { exact: true });
    await expect(reportLayer).toBeVisible();
    await page.getByRole("button", { name: "Insert tick", exact: true }).click();
    await draw(page, reportLayer, [0.7, 0.8], [0.7, 0.8]);
    await expect(page.locator("[data-shape-id]")).toHaveCount(1);
    await page.getByRole("button", { name: "Draw rectangle", exact: true }).click();
    await draw(page, reportLayer, [0.08, 0.7], [0.35, 0.8]);
    await expect(page.locator("[data-shape-id]")).toHaveCount(2);
    for (const id of await page.locator("[data-shape-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-shape-id"))))
      expect(id).toMatch(uuidV4);
    expect(errors).toEqual([]);
  });
}
