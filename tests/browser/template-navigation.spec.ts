import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { Page, Locator, APIRequestContext } from "@playwright/test";
const api = "http://127.0.0.1:8011/api/templates";
const python = (code: string) =>
  execFileSync(resolve("backend/.venv/bin/python"), ["-c", code], {
    cwd: resolve("backend"),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
function fixture() {
  return JSON.parse(
    python(
      "import runpy,json,base64;from io import BytesIO;from reportlab.pdfgen import canvas;s=runpy.run_path('tests/test_templates.py')['definition']();[(setattr(page,'width',600),setattr(page,'height',800)) for page in s.pages];photo=next(f for f in s.fields if f.kind=='image');b=BytesIO();p=canvas.Canvas(b,pagesize=(600,800));p.setFillColorRGB(0,.55,.15);p.rect(photo.x*600,(1-photo.y-photo.height)*800,photo.width*600,photo.height*800,fill=1,stroke=0);p.setFillColorRGB(1,1,1);p.setFont('Helvetica',30);p.drawString(photo.x*600+30,(1-photo.y-photo.height)*800+60,'43.7');p.showPage();p.drawString(30,750,'Second page');p.showPage();p.save();s.ocr_mappings=[];print(json.dumps({'definition':s.model_dump(mode='json'),'pdf':base64.b64encode(b.getvalue()).decode()}))",
    ).toString(),
  );
}
async function seed(request: APIRequestContext) {
  const f = fixture(),
    model = f.definition;
  model.fields.push({
    ...model.fields[3],
    id: "rated",
    label: "Rated current",
    x: 0.4,
  });
  model.fields.push({
    ...model.fields[3],
    id: "load",
    label: "Load",
    kind: "calculated",
    y: 0.42,
    calculation: { operation: "percentage", fields: ["temp", "rated"] },
  });
  model.fields.reverse();
  const result = await request.post(api, {
    multipart: {
      title: "Navigation checks",
      definition_json: JSON.stringify(model),
      pdf: {
        name: "Form.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(f.pdf, "base64"),
      },
    },
  });
  expect(result.ok(), await result.text()).toBe(true);
  return result.json();
}
async function drag(
  page: Page,
  target: Locator,
  start: [number, number],
  end: [number, number],
) {
  await target.scrollIntoViewIfNeeded();
  const b = (await target.boundingBox())!;
  await page.mouse.move(b.x + b.width * start[0], b.y + b.height * start[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * end[0], b.y + b.height * end[1], {
    steps: 5,
  });
  await page.mouse.up();
}
async function pixel(image: Locator) {
  await expect(image).toBeVisible();
  return image.evaluate((node) => {
    const im = node as HTMLImageElement,
      c = document.createElement("canvas");
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    const x = c.getContext("2d")!;
    x.drawImage(im, 0, 0);
    return [
      ...x.getImageData(
        Math.max(0, Math.floor(c.width * 0.1)),
        Math.max(0, Math.floor(c.height * 0.1)),
        1,
        1,
      ).data,
    ];
  });
}

test("PDF upload hides native file status, centers Choose file and immediately selects the first detected input", async ({
  page,
}) => {
  const source = python(
    "import runpy,sys;sys.stdout.buffer.write(runpy.run_path('tests/test_templates.py')['sample_pdf']())",
  );
  await page.goto("/templates/new");
  const choose = page.getByRole("button", { name: "Choose file", exact: true });
  await expect(choose).toBeVisible();
  expect(
    await choose.evaluate((el) => getComputedStyle(el).justifyContent),
  ).toBe("center");
  expect(
    await page
      .locator('.template-upload input[type="file"]')
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(1);
  await expect(page.getByText("No file chosen", { exact: true })).toHaveCount(
    0,
  );
  await page.locator('.template-upload input[type="file"]').setInputFiles({
    name: "New form.pdf",
    mimeType: "application/pdf",
    buffer: source,
  });
  await expect(page.getByLabel("Field label", { exact: true })).toHaveValue(
    "Company",
  );
});

test("opening an edit selects the first editable field and red calculation errors navigate to affected fields", async ({
  page,
  request,
}) => {
  const template = await seed(request);
  await page.goto(`/templates/custom/${template.id}/edit`);
  await expect(page.getByLabel("Field label", { exact: true })).toHaveValue(
    "Company",
  );
  await page
    .locator('[data-box-id="load"][data-box-kind="field"] > rect')
    .first()
    .click();
  await page.getByLabel("Number field 2", { exact: true }).selectOption("");
  await page
    .locator('[data-box-id="company"][data-box-kind="field"] > rect')
    .first()
    .click();
  await page.locator(".calculation-error-link").click();
  await expect(page.getByLabel("Field label", { exact: true })).toHaveValue(
    "Load",
  );
  await page
    .getByRole("button", { name: "Go to Temperature", exact: true })
    .click();
  await expect(page.getByLabel("Field label", { exact: true })).toHaveValue(
    "Temperature",
  );
  await expect
    .poll(() =>
      page.locator(".template-preview-pane").evaluate((el) => el.scrollTop),
    )
    .toBeGreaterThan(100);
  await expect
    .poll(() =>
      page
        .locator('[data-box-id="temp"][data-box-kind="field"]')
        .evaluate((el) => {
          const box = el.getBoundingClientRect(),
            pane = el
              .closest(".template-preview-pane")!
              .getBoundingClientRect();
          return box.top >= pane.top + 60 && box.bottom <= pane.bottom;
        }),
    )
    .toBe(true);
  await page.screenshot({ path: "test-results/template-error-navigation.png" });
});

test("new image boxes preview and extract from the original PDF region; moving and undoing refresh the reference and uploads override it", async ({
  page,
  request,
}) => {
  const template = await seed(request);
  await page.goto(`/templates/custom/${template.id}/edit`);
  const reference = page.getByAltText("Reference image from original PDF", {
    exact: true,
  });
  await expect
    .poll(async () => (await pixel(reference))[1])
    .toBeGreaterThan(100);
  await page.getByRole("button", { name: "Image box", exact: true }).click();
  const layer = page.getByLabel("Template field review, page 1", {
    exact: true,
  });
  await drag(page, layer, [0.55, 0.25], [0.8, 0.4]);
  await expect(page.getByLabel("Field label", { exact: true })).toHaveValue(
    "Image",
  );
  await expect
    .poll(async () => {
      const [r, g, b] = await pixel(reference);
      return r < 30 && g > 100 && b < 100;
    })
    .toBe(true);
  await page
    .getByRole("button", { name: "Extract data from image", exact: true })
    .click();
  expect(
    (await pixel(page.getByAltText("Select the photo area to extract")))[1],
  ).toBeGreaterThan(100);
  await page
    .getByRole("button", { name: "Cancel extraction", exact: true })
    .click();
  const field = layer
    .locator('[data-box-kind="field"]')
    .last()
    .locator("rect")
    .first();
  await drag(page, field, [0.5, 0.5], [-1, -1]);
  await expect
    .poll(async () => {
      const [r, g, b] = await pixel(reference);
      return r > 240 && g > 240 && b > 240;
    })
    .toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => {
      const [r, g] = await pixel(reference);
      return r < 30 && g > 100;
    })
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Extract data from image", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: "test-results/template-pdf-reference.png" });
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 100;
    c.height = 100;
    const x = c.getContext("2d")!;
    x.fillStyle = "red";
    x.fillRect(0, 0, 100, 100);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page
    .getByLabel("Sample photo for extraction", { exact: false })
    .setInputFiles({
      name: "Override.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
  expect(
    (await pixel(page.getByAltText("Sample photo: Override.png")))[0],
  ).toBe(255);
  await expect(reference).toHaveCount(0);
  await page.screenshot({
    path: "test-results/template-reference-preview.png",
  });
});

test("New report is green beside Edit template, not in the header, and navigation still works", async ({
  page,
  request,
}) => {
  const template = await seed(request);
  await page.goto(`/templates/custom/${template.id}`);
  const edit = page.getByRole("link", { name: "Edit template", exact: true }),
    create = page.getByRole("link", { name: "New report", exact: true });
  expect(
    await create.evaluate((el) =>
      el.parentElement?.classList.contains("report-library-actions"),
    ),
  ).toBe(true);
  expect(
    await edit.evaluate((el) =>
      el.nextElementSibling?.textContent?.includes("New report"),
    ),
  ).toBe(true);
  await expect(
    page
      .locator(".catalog-header")
      .getByRole("link", { name: "New report", exact: true }),
  ).toHaveCount(0);
  expect(
    await create.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(22, 101, 52)");
  await create.click();
  await expect(page).toHaveURL(`/templates/custom/${template.id}/new`);
});
