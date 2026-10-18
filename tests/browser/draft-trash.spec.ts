import {test, expect} from "./checker-fixture";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";

const api = "http://127.0.0.1:8011/api/templates";

test("deleted drafts persist in Recently Deleted and restore with saved values and images", async ({page, request}) => {
  const seed = JSON.parse(execFileSync(resolve("backend/.venv/bin/python"), ["-c", [
    "import runpy,json,base64,io",
    "from PIL import Image",
    "t=runpy.run_path('tests/test_templates.py')",
    "image=io.BytesIO();Image.new('RGB',(12,12),'red').save(image,'PNG')",
    "d=t['definition']().model_dump();d['ocr_mappings']=[]",
    "print(json.dumps({'pdf':base64.b64encode(t['sample_pdf']()).decode(),'image':base64.b64encode(image.getvalue()).decode(),'definition':d}))",
  ].join(";")], {cwd: resolve("backend")}).toString());
  const templateResponse = await request.post(api, {multipart: {
    title: "Retention workflow", definition_json: JSON.stringify(seed.definition),
    pdf: {name: "Form.pdf", mimeType: "application/pdf", buffer: Buffer.from(seed.pdf, "base64")},
  }});
  expect(templateResponse.ok()).toBe(true);
  const template = await templateResponse.json();
  const base = `${api}/${template.id}`;
  const created = await request.post(base + "/drafts", {multipart: {
    report_json: JSON.stringify({title: "Recover me", values: {company: "Preserved company"}}),
    image_fields: '["photo"]',
    images: {name: "Camera.png", mimeType: "image/png", buffer: Buffer.from(seed.image, "base64")},
  }});
  expect(created.ok()).toBe(true);
  const draft = await created.json();
  await page.goto(`/templates/custom/${template.id}`);
  await page.getByRole("button", {name: "Delete Recover me", exact: true}).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("restore it for 30 days");
  await dialog.getByRole("button", {name: "Delete draft", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("moved to Recently Deleted");
  await expect(page.getByRole("link", {name: "Open Recover me", exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: /Recently Deleted/}).click();
  await expect(page.getByRole("heading", {name: "Recently Deleted", exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: /Recently Deleted/})).toHaveAttribute("aria-pressed", "true");
  const card = page.locator(".draft-card").filter({hasText: "Recover me"});
  await expect(card).toContainText("Permanently deletes");
  await expect(card.getByRole("link")).toHaveCount(0);
  await expect(card.getByRole("button", {name: /Download|Delete/})).toHaveCount(0);
  await page.screenshot({path: "test-results/recently-deleted-drafts.png", animations: "disabled"});
  // Trash is persisted server-side, not just hidden in browser state.
  await page.reload();
  await page.getByRole("button", {name: /Recently Deleted/}).click();
  await page.getByRole("button", {name: "Restore Recover me", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("Restored");
  await expect(page.getByRole("button", {name: "Restore Recover me", exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: /Your drafts/}).click();
  await expect(page.getByRole("link", {name: "Open Recover me", exact: true})).toBeVisible();
  const restored = await (await request.get(`${base}/drafts/${draft.id}`)).json();
  expect(restored.form).toEqual(draft.form);
  expect(restored.revision_id).toBe(draft.revision_id);
  expect(restored.images).toEqual(draft.images);
  const image = await request.get(`${base}/drafts/${draft.id}/images/photo`);
  expect(await image.body()).toEqual(Buffer.from(seed.image, "base64"));
});
