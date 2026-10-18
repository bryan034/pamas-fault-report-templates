import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { APIRequestContext } from "@playwright/test";

const api = "http://127.0.0.1:8011/api/templates";
const python = (code: string, input?: Buffer) =>
  execFileSync(resolve("backend/.venv/bin/python"), ["-c", code], {
    cwd: resolve("backend"),
    input,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });

async function seed(request: APIRequestContext) {
  const definition = JSON.parse(
    python(
      "import runpy;print(runpy.run_path('tests/test_templates.py')['definition']().model_dump_json())",
    ).toString(),
  );
  definition.ocr_mappings = [];
  definition.fields[0].default_value = "Shared Company";
  definition.fields[3].default_value = "30";
  definition.fields.push({
    ...definition.fields[3],
    id: "rated",
    label: "Rated current",
    x: 0.4,
    default_value: "60",
  });
  definition.fields.push({
    ...definition.fields[3],
    id: "load",
    label: "Load",
    kind: "calculated",
    y: 0.45,
    default_value: "",
    calculation: { operation: "percentage", fields: ["temp", "rated"] },
  });
  definition.fields.push({
    ...definition.fields[0],
    id: "notes",
    label: "Job notes",
    role: null,
    page: 1,
    x: 0.05,
    y: 0.65,
    width: 0.75,
    height: 0.2,
    default_value: "",
  });
  const result = await request.post(api, {
    multipart: {
      title: "Entry workflow",
      definition_json: JSON.stringify(definition),
      pdf: {
        name: "Entry.pdf",
        mimeType: "application/pdf",
        buffer: python(
          "import runpy,sys;sys.stdout.buffer.write(runpy.run_path('tests/test_templates.py')['sample_pdf']())",
        ),
      },
    },
  });
  expect(result.ok(), await result.text()).toBe(true);
  return result.json();
}

test("builder saves explicit defaults, trial entry uses them, existing drafts retain old defaults", async ({
  page,
  request,
}) => {
  const template = await seed(request);
  const old = await (
    await request.post(`${api}/${template.id}/drafts`, {
      multipart: { report_json: '{"title":"Existing job"}' },
    })
  ).json();
  await page.goto(`/templates/custom/${template.id}/edit`);
  await expect(page.getByLabel("Default value for new reports")).toHaveValue(
    "Shared Company",
  );
  await expect(page.locator('[data-template-default="company"]')).toHaveText(
    "Shared Company",
  );
  await page
    .getByLabel("Default value for new reports")
    .fill("New shared value");
  await expect(page.locator('[data-template-default="company"]')).toHaveText(
    "New shared value",
  );
  await page
    .getByRole("button", { name: "View clean template", exact: true })
    .click();
  await expect(
    page.getByText("Clean template preview", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-template-default="company"]')).toHaveText(
    "New shared value",
  );
  await page
    .getByRole("button", { name: "Continue editing template", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Preview report creation flow", exact: true })
    .click();
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "New shared value",
  );
  await page
    .getByLabel("Company", { exact: true })
    .fill("Trial value must not become a default");
  await page.getByLabel("Company", { exact: true }).press("Enter");
  await expect(page.getByLabel("Date", { exact: true })).toBeFocused();
  await expect(
    page.locator('.template-sidebar [data-sidebar-field="load"]'),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Template saved successfully" }),
  ).toBeVisible();
  const current = await (await request.get(`${api}/${template.id}`)).json();
  expect(
    current.definition.fields.find(
      (field: { id: string }) => field.id === "company",
    ).default_value,
  ).toBe("New shared value");
  expect(
    (await (await request.get(`${api}/${template.id}/drafts/${old.id}`)).json())
      .form.values.company,
  ).toBe("Shared Company");
  await page.goto(`/templates/custom/${template.id}/new`);
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "New shared value",
  );
});

test("template defaults update live, fit their boxes and preserve blank, zero and date values", async ({
  page,
  request,
}) => {
  const template = await seed(request);
  await page.goto(`/templates/custom/${template.id}/edit`);
  const control = page.getByLabel("Default value for new reports");
  await control.fill(
    "A reusable company name that needs to fit entirely inside this field boundary",
  );
  const preview = page.locator('[data-template-default="company"]');
  await expect(preview).toContainText("A reusable company name");
  expect(
    await preview.evaluate((svg) => {
      const text = svg.querySelector("text")!;
      const rect = (text as SVGGraphicsElement).getBBox();
      const view = (svg as SVGSVGElement).viewBox.baseVal;
      return (
        rect.x >= -0.1 &&
        rect.y >= -0.1 &&
        rect.x + rect.width <= view.width + 0.1 &&
        rect.y + rect.height <= view.height + 0.1
      );
    }),
  ).toBe(true);
  await control.fill("");
  await expect(preview).toHaveCount(0);
  await expect(page.locator('[data-box-id="company"]')).toContainText(
    "Company",
  );
  await page.locator('[data-box-id="temp"]').click();
  await control.fill("0");
  await expect(page.locator('[data-template-default="temp"]')).toHaveText("0");
  await page.locator('[data-box-id="date"]').click();
  await control.fill("2026-10-18");
  await expect(page.locator('[data-template-default="date"]')).toHaveText(
    "18 Oct 2026",
  );
});

test("report drawing and formatting toolbar stays accessible when scrolling on desktop and mobile", async ({
  page,
  request,
}) => {
  const template = await seed(request);
  await page.goto(`/templates/custom/${template.id}/new`);
  await page.getByLabel("Company", { exact: true }).focus();
  await expect(
    page.getByLabel("Format report field", { exact: true }),
  ).toHaveCount(0);
  const tools = page.locator(".report-preview-tools");
  const pane = page.locator(".report-workspace > .template-preview-pane");
  await expect(page.getByLabel("PDF page 2")).toBeVisible();
  await pane.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () => {
      const toolbar = await tools.boundingBox(),
        scroll = await pane.boundingBox();
      return !!toolbar && !!scroll && Math.abs(toolbar.y - scroll.y) < 2;
    })
    .toBe(true);
  await page.getByLabel("Report font size", { exact: true }).fill("12");
  await expect(
    page.getByLabel("Report font size", { exact: true }),
  ).toHaveValue("12");
  await expect(
    page.getByRole("button", { name: "Draw rectangle", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".report-preview-editor").scrollIntoViewIfNeeded();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect
    .poll(async () => {
      const toolbar = await tools.boundingBox(),
        header = await page.locator(".report-shell > .topbar").boundingBox();
      return (
        !!toolbar &&
        !!header &&
        toolbar.y >= header.y + header.height - 2 &&
        toolbar.y < 844
      );
    })
    .toBe(true);
  await expect(
    page.getByLabel("Report font size", { exact: true }),
  ).toBeVisible();
});

test("Enter navigation, Shift+Enter, alignment and hidden calculations persist to drafts and PDFs", async ({
  page,
  request,
}) => {
  const template = await seed(request);
  const base = `${api}/${template.id}`;
  await page.goto(`/templates/custom/${template.id}/new`);
  await page
    .getByLabel("Report title", { exact: true })
    .fill("Keyboard report");
  await page.getByLabel("Report title", { exact: true }).press("Enter");
  await expect(page.getByLabel("Company", { exact: true })).toBeFocused();
  await page.getByLabel("Company", { exact: true }).press("End");
  await page.getByLabel("Company", { exact: true }).press("Shift+Enter");
  await page.getByLabel("Company", { exact: true }).pressSequentially("Branch");
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Shared Company\nBranch",
  );
  await page.getByLabel("Company", { exact: true }).press("Enter");
  await expect(page.getByLabel("Date", { exact: true })).toBeFocused();
  await page.getByLabel("Date", { exact: true }).fill("2026-10-16");
  await page.getByLabel("Date", { exact: true }).press("Enter");
  await expect(page.getByLabel("Temperature", { exact: true })).toBeFocused();
  await page.getByLabel("Temperature", { exact: true }).press("Enter");
  await expect(page.getByLabel("Rated current", { exact: true })).toBeFocused();
  await page.getByLabel("Rated current", { exact: true }).press("Enter");
  await expect(page.getByLabel("Job notes", { exact: true })).toBeFocused();
  await expect(
    page.locator('.template-sidebar [data-sidebar-field="load"]'),
  ).toHaveCount(0);
  await page.getByLabel("Job notes", { exact: true }).fill("Line one");
  await page.getByLabel("Job notes", { exact: true }).press("Shift+Enter");
  await page
    .getByLabel("Job notes", { exact: true })
    .pressSequentially("Line two");
  await expect(page.getByLabel("Job notes", { exact: true })).toHaveValue(
    "Line one\nLine two",
  );
  await page.getByLabel("Report text alignment").selectOption("right");
  await expect(page.getByLabel("Job notes", { exact: true })).toHaveCSS(
    "text-align",
    "right",
  );

  await page.locator('[data-field-id="company"] .report-field-hit').click();
  const inline = page.getByLabel("Edit Company in preview", { exact: true });
  await inline.fill("Inline first");
  await inline.press("Shift+Enter");
  await inline.pressSequentially("Inline second");
  await inline.press("Enter");
  await expect(
    page.getByLabel("Edit Date in preview", { exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Inline first\nInline second",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/drafts\//);
  const draftId = page.url().split("/").pop();
  const saved = await (await request.get(`${base}/drafts/${draftId}`)).json();
  expect(saved.form.styles.notes.alignment).toBe("right");
  expect(saved.form.values.company).toBe("Inline first\nInline second");
  const pdf = await request.get(`${base}/drafts/${draftId}/pdf`);
  expect(pdf.ok()).toBe(true);
  const text = python(
    "import sys;from io import BytesIO;from pypdf import PdfReader;print('\\n'.join(p.extract_text() for p in PdfReader(BytesIO(sys.stdin.buffer.read())).pages))",
    await pdf.body(),
  ).toString();
  expect(text).toContain("50%");
  expect(text).toContain("Inline first");
  expect(text).toContain("Inline second");
  expect(text).toContain("Line two");
  await page.reload();
  await page.getByLabel("Job notes", { exact: true }).focus();
  await expect(page.getByLabel("Job notes", { exact: true })).toHaveCSS(
    "text-align",
    "right",
  );
});
