import { test, expect } from "./checker-fixture";

test("template library works without contacting the retired Fault Report API", async ({ page }) => {
  const legacyRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.port === "8000" || url.port === "8012") {
      legacyRequests.push(url.href);
      await route.abort("connectionrefused");
      return;
    }
    await route.continue();
  });
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
  await expect(page.locator('a[href^="/templates/fault-report"]')).toHaveCount(0);
  expect(legacyRequests).toEqual([]);
});
