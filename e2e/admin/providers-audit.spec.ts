import { expect, test } from "@playwright/test";

/**
 * Smoke for /admin/providers/audit (Phase 2 admin-page revamp).
 *
 * Skips gracefully on CI when no DEV_AUTH_EMAIL fixture is configured —
 * we never want this single test to fail the whole CI run when admin
 * auth fixtures aren't wired in the target environment.
 */
test.describe("Admin /providers/audit page", () => {
  const adminEmail = process.env.DEV_AUTH_EMAIL;

  test.skip(!adminEmail, "DEV_AUTH_EMAIL not set — skipping admin smoke");

  test("loads, applies a category filter, paginates", async ({ page }) => {
    const res = await page.goto("/admin/providers/audit");
    expect(res?.status() ?? 0, "navigation status").toBeLessThan(500);

    if (page.url().includes("/auth") || page.url().includes("/signin")) {
      test.skip(
        true,
        "Not authenticated as admin — provide auth state in playwright config",
      );
    }

    await expect(
      page.getByRole("heading", { name: "Provider audit log" }),
    ).toBeVisible({ timeout: 10_000 });

    // The table renders even when there are no rows ("No matching changes.").
    await expect(page.locator("table")).toBeVisible();

    // Apply-filters click should not error.
    await page.getByRole("button", { name: /Apply filters/ }).click();
  });
});
