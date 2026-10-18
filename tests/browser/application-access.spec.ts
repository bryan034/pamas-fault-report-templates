import { test, expect } from "./checker-fixture";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// UI capabilities are simulated here; signed identities and API permissions are
// verified separately by test_application_access.py, not by these route mocks.
test("viewer browses and downloads a saved report without mutation controls", async ({
  page,
  request,
}) => {
  const generated = execFileSync(
    resolve("backend/.venv/bin/python"),
    [
      "-c",
      "import runpy,json,base64;t=runpy.run_path('tests/test_templates.py');print(json.dumps({'pdf':base64.b64encode(t['sample_pdf']()).decode(),'definition':t['definition']().model_dump()}))",
    ],
    { cwd: resolve("backend") },
  );
  const seed = JSON.parse(generated.toString());
  const template = await request.post("http://127.0.0.1:8011/api/templates", {
    multipart: {
      title: "Access UI test",
      reviewed: "true",
      definition_json: JSON.stringify(seed.definition),
      pdf: {
        name: "form.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(seed.pdf, "base64"),
      },
    },
  });
  expect(template.ok()).toBeTruthy();
  const { id } = await template.json();
  const draft = await request.post(
    `http://127.0.0.1:8011/api/templates/${id}/drafts`,
    {
      multipart: {
        report_json: JSON.stringify({
          title: "Viewer report",
          values: { company: "Viewer company" },
        }),
      },
    },
  );
  expect(draft.ok()).toBeTruthy();
  await page.route("**/api/access/me", (route) =>
    route.fulfill({
      json: { mode: "cloudflare", email: "viewer@example.com", role: "viewer" },
    }),
  );
  await page.goto("/");
  await expect(page.getByText("viewer@example.com · viewer")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Create new template" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit template" })).toHaveCount(
    0,
  );
  await page.goto(`/templates/custom/${id}`);
  await expect(
    page.getByRole("link", { name: "View draft", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "New report" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete Viewer report" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "View draft", exact: true }).click();
  await expect(page.getByText("Read-only · Viewer access")).toBeVisible();
  await expect(page.getByLabel("PDF page 1")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("Viewer report.pdf");
  await page.goto("/templates/new");
  await expect(page.getByRole("alert")).toContainText(
    "Editor access is required",
  );
  await request.delete(`http://127.0.0.1:8011/api/templates/${id}`);
  await request.delete(
    `http://127.0.0.1:8011/api/templates/${id}/permanent?confirmed=true`,
  );
});

test("owner access page grants, changes and revokes roles with confirmation", async ({
  page,
}) => {
  const grants: Record<string, string> = {};
  await page.route("**/api/access/me", (route) =>
    route.fulfill({
      json: { mode: "cloudflare", email: "owner@example.com", role: "owner" },
    }),
  );
  await page.route("**/api/access/users**", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      const value = request.postDataJSON();
      grants[value.email] = value.role;
      return route.fulfill({ json: value });
    }
    if (request.method() === "DELETE") {
      delete grants[
        decodeURIComponent(new URL(request.url()).pathname.split("/").pop()!)
      ];
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      json: {
        owner: "owner@example.com",
        users: Object.entries(grants).map(([email, role]) => ({ email, role })),
      },
    });
  });
  await page.goto("/access");
  await page.getByLabel("Email", { exact: true }).fill("member@example.com");
  await page.getByLabel("Role", { exact: true }).selectOption("viewer");
  await page.getByRole("button", { name: "Grant access" }).click();
  await expect(page.getByRole("status")).toContainText("They can sign in with that Google account");
  await expect(page.getByLabel("Role for member@example.com")).toHaveValue(
    "viewer",
  );
  await page.getByLabel("Role for member@example.com").selectOption("editor");
  await expect(page.getByLabel("Role for member@example.com")).toHaveValue(
    "editor",
  );
  await page.getByRole("button", { name: "Remove access" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Revoke access", exact: true })
    .click();
  await expect(page.getByLabel("Role for member@example.com")).toHaveCount(0);
  expect(grants).toEqual({});
});

test("unapproved accounts cannot render application pages and hosted accounts have sign-out", async ({page}) => {
  await page.route("**/api/access/me", route => route.fulfill({
    status: 403, json: {detail: "Ask the application owner to grant access"},
  }));
  await page.goto("/");
  await expect(page.getByRole("heading", {name: "Application access required"})).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Ask the application owner");
  await expect(page.getByRole("heading", {name: "Your report templates"})).toHaveCount(0);
  await expect(page.getByRole("link", {name: "Manage access", exact: true})).toHaveCount(0);
  await page.unroute("**/api/access/me");
  await page.route("**/api/access/me", route => route.fulfill({
    json: {mode: "cloudflare", email: "member@gmail.com", role: "editor"},
  }));
  await page.goto("/");
  await expect(page.getByRole("link", {name: "Sign out", exact: true})).toHaveAttribute("href", "/cdn-cgi/access/logout");
});

test("local mode labels no-login development and disables access management", async ({
  page,
}) => {
  await page.goto("/access");
  await expect(page.getByText("Local development — no login")).toBeVisible();
  await expect(
    page.getByText("Access management requires Cloudflare sign-in.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Grant access" })).toHaveCount(
    0,
  );
});
