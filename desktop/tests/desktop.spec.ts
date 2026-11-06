import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const desktop = join(__dirname, "..");
const executable = join(desktop, process.platform === "darwin"
  ? "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
  : "node_modules/electron/dist/electron");
const title = process.env.DESKTOP_EXPECT_TEMPLATE || "4-1) Fault report 1";

let profile: string;
test.beforeEach(() => { profile = mkdtempSync(join(tmpdir(), "report-formatter-desktop-")); });
test.afterEach(() => rmSync(profile, { recursive: true, force: true }));

async function launch(): Promise<{ application: ElectronApplication; page: Page }> {
  // Editors built on Electron export this to their terminals; it would disable the app.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "ELECTRON_RUN_AS_NODE")) as Record<string, string>;
  const application = await electron.launch({ executablePath: executable, args: [desktop, `--user-data-dir=${profile}`], env });
  const page = await application.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120_000 });
  return { application, page };
}

test("installs starter templates, works offline and refuses outside requests", async () => {
  const { application, page } = await launch();
  const consoleErrors: string[] = [];
  const outside: string[] = [];
  page.on("pageerror", error => consoleErrors.push(error.message));
  page.on("request", request => {
    if (!/^(http:\/\/127\.0\.0\.1:\d+\/|blob:|data:)/.test(request.url())) outside.push(request.url());
  });
  await expect(page.getByText(title).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Back up" })).toBeVisible();
  await expect(page.getByText("Local development")).toHaveCount(0);

  const origin = new URL(page.url()).origin;
  expect((await fetch(`${origin}/api/templates`)).status).toBe(403);
  for (const [path, type] of [["/pdf.worker.min.mjs", "javascript"], ["/ocr/worker.min.js", "javascript"]]) {
    const response = await page.request.fetch(origin + path, { headers: { "X-Desktop-Token": "wrong" } }).catch(() => null);
    expect(response?.status() ?? 403).toBe(403);
    const inside = await page.evaluate(async url => {
      const answer = await fetch(url);
      return { status: answer.status, type: answer.headers.get("content-type") };
    }, path);
    expect(inside.status).toBe(200);
    expect(inside.type).toContain(type);
  }

  // Direct loads of client routes must return the shell, and the PDF editor must draw.
  const { templates: [template] } = await page.evaluate(async () => (await fetch("/api/templates")).json()) as { templates: { id: string }[] };
  await page.goto(`${origin}/templates/custom/${template.id}/new`);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => [...document.querySelectorAll("canvas")].some(canvas => canvas.width > 100));
  expect(consoleErrors).toEqual([]);
  expect(outside).toEqual([]);
  await application.close();
});

test("backs up, restores and keeps data between launches", async () => {
  const target = join(profile, "usb-drive.rfbackup");
  let { application, page } = await launch();
  await expect(page.getByText("Not backed up yet")).toBeVisible();
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, target);
  await page.getByRole("button", { name: "Back up" }).click();
  await expect(page.getByText(/Last backup:/)).toBeVisible({ timeout: 60_000 });
  expect(statSync(target).size).toBeGreaterThan(1000);

  const rename = (id: string, next: string) => page.evaluate(async ([identifier, value]) => {
    const response = await fetch(`/api/templates/${identifier}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: value }),
    });
    if (!response.ok) throw new Error(`Rename failed: ${response.status}`);
  }, [id, next]);
  const list = () => page.evaluate(async () => (await (await fetch("/api/templates")).json()) as { templates: { id: string; title: string }[] });
  const original = (await list()).templates.find(item => item.title === title)!;
  await rename(original.id, "Changed after backup");
  await page.reload();
  await expect(page.getByText("Changed after backup")).toBeVisible();

  const firstOrigin = new URL(page.url()).origin;
  await page.getByRole("button", { name: "Restore" }).click();
  await page.waitForURL(url => url.origin !== firstOrigin, { timeout: 120_000 });
  await expect(page.getByText(title).first()).toBeVisible();
  await expect(page.getByText("Changed after backup")).toHaveCount(0);
  expect(existsSync(join(profile, "data", "safety-copies"))).toBe(true);

  await rename(original.id, "Kept between launches");
  await application.close();
  ({ application, page } = await launch());
  await expect(page.getByText("Kept between launches")).toBeVisible();
  await expect(page.getByText(/Last backup:/)).toBeVisible();
  await application.close();
});
