import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const api = "http://127.0.0.1:8011";
const python = (code: string) =>
  execFileSync(resolve("backend/.venv/bin/python"), ["-c", code], {
    cwd: resolve("backend"),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });

test("PDF templates export Word and PDF without an original-template download button", async ({
  page,
  request,
}) => {
  const model = python(
    "import runpy;print(runpy.run_path('tests/test_templates.py')['definition']().model_dump_json())",
  ).toString();
  const source = python(
    "import runpy,sys;sys.stdout.buffer.write(runpy.run_path('tests/test_templates.py')['sample_pdf']())",
  );
  const saved = await request.post(api + "/api/templates", {
    multipart: {
      title: "PDF cross-format",
      definition_json: model,
      pdf: { name: "source.pdf", mimeType: "application/pdf", buffer: source },
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const template = await saved.json();
  await page.goto(`/templates/custom/${template.id}/new`);
  await page
    .getByLabel("Report title", { exact: true })
    .fill("Cross-format job");
  await page.getByLabel("Company", { exact: true }).fill("Acme");
  for (const [button, extension] of [
    ["Download Word", "docx"],
    ["Download PDF", "pdf"],
  ]) {
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: button, exact: true }).click();
    expect((await downloading).suggestedFilename()).toBe(
      `Cross-format job.${extension}`,
    );
  }
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/drafts\//);
  await page.goto(`/templates/custom/${template.id}`);
  for (const [button, extension] of [
    ["Download PDF", "pdf"],
    ["Download Word", "docx"],
  ]) {
    await page
      .getByRole("button", { name: "Download Cross-format job", exact: true })
      .click();
    const downloading = page.waitForEvent("download");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: button, exact: true })
      .click();
    expect((await downloading).suggestedFilename()).toBe(
      `Cross-format job.${extension}`,
    );
  }
  await expect(
    page.getByRole("button", {
      name: "Download original template",
      exact: true,
    }),
  ).toHaveCount(0);
  const original = await request.get(
    `${api}/api/templates/${template.id}/original`,
  );
  expect(await original.body()).toEqual(source); // Hiding the button does not delete source bytes.
});

test("legacy converted Word templates keep the shared builder, defaults, drafts and both exports", async ({
  page,
  request,
}) => {
  // Set to a DISPOSABLE service image with LibreOffice and its own SQLite DB.
  // Never point this at the saved local PostgreSQL service or production.
  const wordApi = process.env.QA_WORD_API_URL;
  test.skip(
    !wordApi,
    "Run with QA_WORD_API_URL against the disposable LibreOffice service",
  );
  await page.route(`${api}/api/**`, async (route) => {
    const response = await route.fetch({
      url: route.request().url().replace(api, wordApi!),
    });
    await route.fulfill({ response });
  });
  const source = python(
    "import runpy,sys;sys.path.insert(0,'tests');sys.stdout.buffer.write(runpy.run_path('tests/test_word_templates.py')['sample_word']())",
  );
  // Seed through the retained legacy API, not the new native DOCX upload UI.
  const document = { name: "Word inspection.docx", mimeType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: source };
  const analysis = await request.post(wordApi + "/api/templates/analyze", { multipart: { pdf: document } });
  expect(analysis.ok()).toBeTruthy();
  const saved = await request.post(wordApi + "/api/templates", { multipart: {
    title: "Word inspection", pdf: document, definition_json: JSON.stringify((await analysis.json()).definition),
  } });
  expect(saved.ok()).toBeTruthy();
  const template = await saved.json();
  await page.goto(`/templates/custom/${template.id}/edit`);
  await expect(
    page.getByRole("toolbar", { name: "Template editing tools" }),
  ).toBeVisible();
  await page.getByLabel("Field label", { exact: true }).fill("Reusable value");
  await page.getByLabel("Default value for new reports").fill("Word default");
  await page
    .getByRole("button", { name: "Preview report creation flow", exact: true })
    .click();
  await expect(page.getByLabel("Reusable value", { exact: true })).toHaveValue(
    "Word default",
  );
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Template saved successfully" }),
  ).toBeVisible();
  const listing = await (await request.get(wordApi + "/api/templates")).json();
  const listed = listing.templates.find(
    (item: { title: string }) => item.title === "Word inspection",
  );
  expect(listed).toBeTruthy();
  await page.goto(`/templates/custom/${template.id}/edit`);
  await expect(page.getByLabel("Default value for new reports")).toHaveValue(
    "Word default",
  );
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Template saved successfully" }),
  ).toBeVisible();
  const original = await request.get(
    `${wordApi}/api/templates/${template.id}/original`,
  );
  expect(await original.body()).toEqual(source);
  await page.goto(`/templates/custom/${template.id}/new`);
  await page.getByLabel("Report title", { exact: true }).fill("Word job");
  await expect(page.getByLabel("Reusable value", { exact: true })).toHaveValue(
    "Word default",
  );
  await page.getByLabel("Reusable value", { exact: true }).fill("Report value");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/drafts\//);
  for (const [button, extension] of [
    ["Download Word", "docx"],
    ["Download PDF", "pdf"],
  ]) {
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: button, exact: true }).click();
    expect((await downloading).suggestedFilename()).toBe(
      `Word job.${extension}`,
    );
  }
  expect(
    (
      await (
        await request.get(`${wordApi}/api/templates/${template.id}`)
      ).json()
    ).source_format,
  ).toBe("docx");
});
