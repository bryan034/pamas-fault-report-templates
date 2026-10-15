import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

test("saved reports open their original fields after editing and fresh reports use the new revision", async ({
  page,
  request,
}) => {
  const run = (code: string) =>
    execFileSync(resolve("backend/.venv/bin/python"), ["-c", code], {
      cwd: resolve("backend"),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
  const model = JSON.parse(
    run(
      "import runpy;print(runpy.run_path('tests/test_templates.py')['definition']().model_dump_json())",
    ).toString(),
  );
  model.ocr_mappings = [];
  const api = "http://127.0.0.1:8011/api/templates";
  const created = await request.post(api, {
    multipart: {
      title: "Version preservation",
      reviewed: "true",
      definition_json: JSON.stringify(model),
      pdf: {
        name: "source.pdf",
        mimeType: "application/pdf",
        buffer: run(
          "import runpy,sys;sys.stdout.buffer.write(runpy.run_path('tests/test_templates.py')['sample_pdf']())",
        ),
      },
    },
  });
  const template = await created.json(),
    base = api + "/" + template.id;
  const saved = await request.post(base + "/drafts", {
      multipart: {
        report_json: JSON.stringify({
          title: "Original job",
          values: { company: "Original Company" },
        }),
      },
    }),
    draft = await saved.json();
  model.fields[0].id = "new_company";
  model.fields[0].label = "Changed company";
  model.fields[0].font_size = 22;
  const edited = await request.put(base, {
    multipart: {
      title: template.title,
      reviewed: "true",
      definition_json: JSON.stringify(model),
      expected_revision_id: template.revision_id,
    },
  });
  expect(edited.status()).toBe(200);
  await page.goto(`/templates/custom/${template.id}/drafts/${draft.id}`);
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Original Company",
  );
  await expect(page.getByLabel("Changed company", { exact: true })).toHaveCount(
    0,
  );
  await page.goto(`/templates/custom/${template.id}/new`);
  await expect(page.getByLabel("Changed company", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("Company", { exact: true })).toHaveCount(0);
  await page.goto(`/templates/custom/${template.id}/edit`);
  await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(
    "Version preservation",
  );
  await page
    .locator('[data-box-kind="field"]')
    .filter({ hasText: /^Changed company/ })
    .click();
  await expect(page.getByLabel("Font size", { exact: true })).toHaveValue("22");
});
