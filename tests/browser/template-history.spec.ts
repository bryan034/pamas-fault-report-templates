import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

test("undo retains exactly five moves, redo restores them, and new edits discard redo", async ({
  page,
}) => {
  const pdf = execFileSync(
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
  await page.goto("/templates/new");
  await page.locator("input[type=file]").first().setInputFiles({
    name: "History.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await page
    .locator('[data-box-kind="field"]')
    .filter({ hasText: /^Company/ })
    .click();
  const selectedRect = page
    .locator('[data-box-kind="field"]')
    .first()
    .locator("rect")
    .first();
  const origin = Number(await selectedRect.getAttribute("x"));
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  const moved = Number(await selectedRect.getAttribute("x"));
  expect(moved).toBeGreaterThan(origin);
  for (let i = 0; i < 5; i++) await page.keyboard.press("Meta+z");
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  expect(Number(await selectedRect.getAttribute("x"))).toBeGreaterThan(origin);
  for (let i = 0; i < 5; i++) await page.keyboard.press("Meta+Shift+z");
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeDisabled();
  expect(Number(await selectedRect.getAttribute("x"))).toBe(moved);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Field label", { exact: true })
    .fill("Editing text safely");
  await page.getByLabel("Field label", { exact: true }).press("Backspace");
  await expect(page.locator('[data-box-kind="field"]')).toHaveCount(2);
});
