import { test, expect } from "./checker-fixture";

test("template library handles an empty database and archived filtering", async ({ page }) => {
  // Keep this independent of templates seeded by other scenarios.
  await page.route("**/api/templates", (route) => route.fulfill({
    json: { templates: [] },
  }));
  await page.route("**/api/templates?archived=true", (route) => route.fulfill({
    json: { templates: [] },
  }));
  const active = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/templates" &&
    !new URL(response.url()).search,
  );
  const archived = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/templates" &&
    new URL(response.url()).searchParams.get("archived") === "true",
  );
  await page.goto("/");
  await Promise.all([active, archived]);
  await expect(page.getByRole("heading", { name: "Report Formatter" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create new template" })).toBeVisible();
  await expect(page.locator(".template-card")).toHaveCount(0);
  await expect(page.locator(".catalog-error")).toHaveCount(0);
  await page.getByLabel("Show archived templates").check();
});
