// Full function check in the real desktop shell. Uses the bundled templates in a
// throwaway profile. Downloads go to desktop/.build/check-output for inspection; that
// folder is ignored by git because the files contain the bundled templates.
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const desktop = join(__dirname, "..");
const output = join(desktop, ".build", "check-output");
const executable = join(desktop, process.platform === "darwin"
  ? "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
  : "node_modules/electron/dist/electron");

type Field = { id: string; label: string; kind: string };
type Finished = { name: string; path: string; state: string };
type Downloads = { checkDownloads: Finished[] };
type DownloadItem = {
  getFilename(): string;
  setSavePath(path: string): void;
  once(event: "done", listener: (event: unknown, state: string) => void): void;
};
type Template = { id: string; title: string; revision_number: number; definition: { fields: Field[] } };

let profile: string;
let application: ElectronApplication;
let page: Page;
let pageErrors: string[];

test.beforeEach(async () => {
  mkdirSync(output, { recursive: true });
  profile = mkdtempSync(join(tmpdir(), "report-formatter-check-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "ELECTRON_RUN_AS_NODE")) as Record<string, string>;
  application = await electron.launch({ executablePath: executable, args: [desktop, `--user-data-dir=${profile}`], env });
  page = await application.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120_000 });
  // Answers the "unsaved changes" prompt, which would otherwise wait for a person.
  await application.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1;
  });
  await application.evaluate(({ session }, folder) => {
    const finished: Finished[] = [];
    (globalThis as unknown as Downloads).checkDownloads = finished;
    session.defaultSession.on("will-download", (_event: unknown, item: DownloadItem) => {
      const entry = { name: item.getFilename(), path: `${folder}/${finished.length}-${item.getFilename()}`, state: "" };
      item.setSavePath(entry.path);
      item.once("done", (_done: unknown, state: string) => finished.push({ ...entry, state }));
    });
  }, profile);
  pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
});

test.afterEach(async () => {
  await application.close();
  rmSync(profile, { recursive: true, force: true });
  expect(pageErrors).toEqual([]);
});

const api = <T>(path: string) => page.evaluate(async url => (await (await fetch(url)).json()), path) as Promise<T>;
const slug = (text: string) => text.replace(/[^A-Za-z0-9]+/g, "-");

/** The window normally asks where to save; this answers that step, on Electron's real download path. */
async function saveDownload(trigger: () => Promise<unknown>, name: string) {
  const before = await application.evaluate(() => (globalThis as unknown as Downloads).checkDownloads.length);
  await trigger();
  let finished: Finished | undefined;
  await expect.poll(async () => {
    finished = (await application.evaluate(() => (globalThis as unknown as Downloads).checkDownloads))[before];
    return finished?.state;
  }, { timeout: 120_000, message: `download of ${name}` }).toBe("completed");
  const path = join(output, name);
  copyFileSync(finished!.path, path);
  const start = readFileSync(path).subarray(0, 4).toString("latin1");
  expect(start, name).toBe(name.endsWith(".pdf") ? "%PDF" : "PK\u0003\u0004");
  return finished!.name;
}

const click = (name: string) => () => page.getByRole("button", { name, exact: true }).first().click();

async function photo(lines: string[]) {
  const data = await page.evaluate(values => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 600;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#222222";
    context.fillRect(0, 0, 900, 600);
    context.font = "bold 38px Arial";
    context.fillStyle = "white";
    values.forEach((value, index) => context.fillText(value, 60, 90 + index * 65));
    return canvas.toDataURL("image/png").split(",")[1];
  }, lines);
  return { name: "Thermal.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") };
}

const imageSection = (label: string) => page.locator(".template-image-input").filter({ has: page.getByRole("heading", { name: label, exact: true }) });

async function fillEveryField(template: Template) {
  // Photos first: a new photo clears any values previously read from that image.
  for (const field of template.definition.fields.filter(item => item.kind === "image")) {
    const section = imageSection(field.label).first();
    await section.locator('input[type="file"]').setInputFiles(await photo(["Check photo"]));
    await expect(section.locator("img").first()).toBeVisible();
  }
  // Multi-page templates repeat labels, so address each repeat by its position.
  const seen = new Map<string, number>();
  for (const field of template.definition.fields) {
    const value = { text: "Test", number: "12", date: "2026-11-07" }[field.kind];
    if (!value) continue;
    const position = seen.get(field.label) ?? 0;
    seen.set(field.label, position + 1);
    await page.getByLabel(field.label, { exact: true }).nth(position).fill(value);
  }
}

test("every bundled template downloads blank and filled in PDF and Word, and drafts work", async () => {
  test.setTimeout(600_000);
  const { templates } = await api<{ templates: { id: string; title: string }[] }>("/api/templates");
  expect(templates.map(item => item.title).sort()).toEqual(["4-1) Fault report 1", "S6) Fault report section"]);
  const origin = new URL(page.url()).origin;

  for (const { id, title } of templates) {
    const prefix = slug(title);
    const template = await api<Template>(`/api/templates/${id}`);

    await page.goto(`${origin}/templates/custom/${id}`);
    await expect(page.getByRole("button", { name: "Download blank Word", exact: true })).toBeVisible();
    expect(await saveDownload(click("Download blank PDF"), `${prefix}-blank.pdf`)).toBe(`${title}-blank.pdf`);
    expect(await saveDownload(click("Download blank Word"), `${prefix}-blank.docx`)).toBe(`${title}-blank.docx`);

    await page.goto(`${origin}/templates/custom/${id}/new`);
    await page.getByLabel("Report title", { exact: true }).fill("Check report");
    await fillEveryField(template);
    await page.waitForFunction(() => [...document.querySelectorAll("canvas")].some(canvas => canvas.width > 100));
    await saveDownload(click("Download PDF"), `${prefix}-filled.pdf`);
    await saveDownload(click("Download Word"), `${prefix}-filled.docx`);

    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page).toHaveURL(/\/drafts\//);
    const draftId = page.url().split("/").at(-1)!;
    const saved = await api<{ form: { values: Record<string, string> } }>(`/api/templates/${id}/drafts/${draftId}`);
    const typed = template.definition.fields.filter(field => field.kind === "number");
    for (const field of typed) expect(saved.form.values[field.id], field.label).toBe("12");

    await page.reload();
    await expect(page.getByLabel("Report title", { exact: true })).toHaveValue("Check report");

    // The saved-draft card asks which format to download.
    await page.goto(`${origin}/templates/custom/${id}`);
    for (const [button, extension] of [["Download PDF", "pdf"], ["Download Word", "docx"]]) {
      await page.getByRole("button", { name: "Download Check report", exact: true }).click();
      await expect(page.getByRole("dialog").getByText("Choose a download format")).toBeVisible();
      const chosen = () => page.getByRole("dialog").getByRole("button", { name: button, exact: true }).click();
      expect(await saveDownload(chosen, `${prefix}-draft.${extension}`)).toBe(`Check report.${extension}`);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    // Rename, delete and recover the draft.
    await page.getByRole("button", { name: "Rename Check report", exact: true }).click();
    await page.locator(".rename-inline input").fill("Renamed report");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Delete Renamed report", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /Delete|Move/ }).click();
    await expect(page.getByRole("status")).toContainText("moved to Recently Deleted");
    await page.getByRole("button", { name: /Recently Deleted/ }).click();
    await page.getByRole("button", { name: "Restore Renamed report", exact: true }).click();
    await expect(page.getByRole("button", { name: "Restore Renamed report", exact: true })).toHaveCount(0);
  }

  // Archive and recover a template; its saved report stays.
  const { id, title } = templates[0];
  await page.goto(`${origin}/`);
  await page.getByRole("button", { name: `Delete ${title}`, exact: true }).click();
  await page.getByRole("button", { name: "Archive template", exact: true }).click();
  await expect(page.getByRole("link", { name: `Open ${title}`, exact: true })).toHaveCount(0);
  await page.getByLabel("Show archived templates").check();
  await page.getByRole("button", { name: `Recover ${title}`, exact: true }).click();
  await page.getByLabel("Show archived templates").uncheck();
  await expect(page.getByRole("link", { name: `Open ${title}`, exact: true })).toBeVisible();
  const drafts = await api<{ drafts: unknown[] }>(`/api/templates/${id}/drafts`);
  expect(drafts.drafts).toHaveLength(1);
});

test("photo OCR fills BX readings with no network", async () => {
  test.setTimeout(240_000);
  const { templates } = await api<{ templates: { id: string; title: string }[] }>("/api/templates");
  const { id } = templates.find(item => item.title.startsWith("S6"))!;
  const outside: string[] = [];
  page.on("request", request => {
    if (!/^(http:\/\/127\.0\.0\.1:\d+\/|blob:|data:)/.test(request.url())) outside.push(request.url());
  });
  await page.goto(`${new URL(page.url()).origin}/templates/custom/${id}/new`);
  await page.getByLabel("Report title", { exact: true }).fill("OCR check");
  const section = imageSection("FLIR Image 1").first();
  await section.locator('input[type="file"]').setInputFiles(await photo(["BX1: 41.0 °C", "BX2: 42.3 °C", "BX3: 43.4 °C"]));
  await section.getByRole("button", { name: "Extract BX values from image", exact: true }).click();
  await expect(page.getByLabel("Bx1", { exact: true }).first()).toHaveValue("41.0", { timeout: 120_000 });
  await expect(page.getByLabel("Bx2", { exact: true }).first()).toHaveValue("42.3");
  await expect(page.getByLabel("Bx3", { exact: true }).first()).toHaveValue("43.4");
  expect(outside).toEqual([]);
});

test("uploads, edits and removes Word and PDF templates", async () => {
  test.skip(!process.env.LIBREOFFICE_BINARY, "Word upload needs LIBREOFFICE_BINARY on this computer");
  test.setTimeout(420_000);
  const origin = new URL(page.url()).origin;
  const sample = process.env.DESKTOP_SAMPLE_DOCX || join(desktop, ".build", "check-output", "sample.docx");
  const python = join(desktop, "..", "backend", ".venv", "bin", "python");
  execFileSync(python, ["-c", `
from docx import Document
d=Document(); d.add_heading("Check inspection",1); d.add_paragraph("Equipment: ______________"); d.add_paragraph("Date: ______________")
t=d.add_table(rows=2,cols=2); t.cell(0,0).text="Rated"; t.cell(0,1).text="Measured"
d.add_page_break(); d.add_paragraph("Second page"); d.save(${JSON.stringify(sample)})`]);

  for (const [kind, file] of [["Word", sample], ["PDF", join(output, "4-1-Fault-report-1-blank.pdf")]] as const) {
    const name = `Uploaded ${kind}`;
    await page.goto(`${origin}/templates/new`);
    await page.getByLabel("Upload report PDF or Word document").setInputFiles(file);
    await expect(page.getByRole("toolbar", { name: "Template editing tools" })).toBeVisible({ timeout: 240_000 });
    await page.getByLabel("Template name", { exact: true }).fill(name);
    if (!(await page.getByLabel("Field label", { exact: true }).count())) {
      await page.getByRole("button", { name: "Input field", exact: true }).click();
      const box = (await page.locator(".template-box-layer").first().boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.16, { steps: 4 });
      await page.mouse.up();
      await page.getByLabel("Field label", { exact: true }).fill("Equipment");
    }
    await page.getByRole("button", { name: "Save template", exact: true }).click();
    await expect(page).toHaveURL(/\/templates\/custom\/[^/]+$/, { timeout: 60_000 });
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const created = await api<Template>(`/api/templates/${id}`);
    expect(created.definition.fields.length, "detected fields").toBeGreaterThan(0);

    await saveDownload(click("Download blank PDF"), `${slug(name)}-blank.pdf`);
    await saveDownload(click("Download blank Word"), `${slug(name)}-blank.docx`);

    await page.goto(`${origin}/templates/custom/${id}/new`);
    await page.getByLabel("Report title", { exact: true }).fill("Uploaded report");
    await saveDownload(click("Download PDF"), `${slug(name)}-report.pdf`);
    await saveDownload(click("Download Word"), `${slug(name)}-report.docx`);

    // Editing makes a new revision.
    await page.goto(`${origin}/templates/custom/${id}/edit`);
    await page.getByLabel("Template name", { exact: true }).fill(`${name} revised`);
    await page.getByRole("button", { name: "Save template", exact: true }).click();
    await expect(page).toHaveURL(/\/templates\/custom\/[^/]+$/, { timeout: 60_000 });
    const edited = await api<Template>(`/api/templates/${id}`);
    expect(edited.title).toBe(`${name} revised`);
    expect(edited.revision_number).toBe(created.revision_number + 1);

    // Archive, then permanently delete.
    await page.goto(`${origin}/`);
    await page.getByRole("button", { name: `Delete ${edited.title}`, exact: true }).click();
    await page.getByRole("button", { name: "Archive template", exact: true }).click();
    await expect(page.getByRole("link", { name: `Open ${edited.title}`, exact: true })).toHaveCount(0);
    const removed = await page.evaluate(async url => (await fetch(url, { method: "DELETE" })).status, `/api/templates/${id}/permanent?confirmed=true`);
    expect(removed).toBe(204);
  }
});

test("a backup to a missing drive reports a clear problem", async () => {
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, join(profile, "unplugged-usb", "backup.rfbackup"));
  await page.getByRole("button", { name: "Back up", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Check the drive is connected");
  await expect(page.getByRole("button", { name: "Back up", exact: true })).toBeEnabled();
});
