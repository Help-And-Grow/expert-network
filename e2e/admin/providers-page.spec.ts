import { expect, test } from "@playwright/test";

/**
 * Smoke for /admin/providers (Phase 1 admin-page revamp).
 *
 * Skips gracefully on CI when no DEV_AUTH_EMAIL fixture is configured —
 * we never want this single test to fail the whole CI run when admin
 * auth fixtures aren't wired in the target environment.
 */
test.describe("Admin /providers page", () => {
  const adminEmail = process.env.DEV_AUTH_EMAIL;

  test.skip(
    !adminEmail,
    "DEV_AUTH_EMAIL not set — skipping admin smoke",
  );

  test("loads the page, switches tabs, renders LLM cards", async ({
    page,
  }) => {
    // The repo's existing pattern is for the auth fixture to be supplied
    // out-of-band (storageState in playwright.config.ts). If the test is
    // running unauthenticated, /admin/providers will redirect to sign-in
    // — assert that we reach SOME admin surface and bail.
    const res = await page.goto("/admin/providers");
    expect(res?.status() ?? 0, "navigation status").toBeLessThan(500);

    if (page.url().includes("/auth") || page.url().includes("/signin")) {
      test.skip(
        true,
        "Not authenticated as admin — provide auth state in playwright config to enable",
      );
    }

    // Page header
    await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible({
      timeout: 10_000,
    });

    // Tab switching
    await page.getByRole("tab", { name: "Storage" }).click();
    await expect(
      page.getByText("Active storage provider"),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Database" }).click();
    await expect(page.getByText(/Provider:\s*/)).toBeVisible();

    await page.getByRole("tab", { name: "LLM" }).click();
    // At least one LLM provider card renders (post-seed).
    await expect(page.getByText("Active LLM provider")).toBeVisible();
  });
});
