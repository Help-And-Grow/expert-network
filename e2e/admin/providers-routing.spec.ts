import { expect, test } from "@playwright/test";

/**
 * Phase 3 smoke for /admin/providers — Routing Scopes section.
 *
 * Skips gracefully on CI when DEV_AUTH_EMAIL is not configured (mirrors
 * the pattern in providers-page.spec.ts). The test only verifies that
 * the new "Routing scopes" UI is present — the chain editing logic is
 * exercised by the unit tests.
 */
test.describe("Admin /providers — Routing scopes (Phase 3)", () => {
  const adminEmail = process.env.DEV_AUTH_EMAIL;

  test.skip(!adminEmail, "DEV_AUTH_EMAIL not set — skipping admin smoke");

  test("renders the Routing scopes section in the LLM tab", async ({ page }) => {
    const res = await page.goto("/admin/providers");
    expect(res?.status() ?? 0, "navigation status").toBeLessThan(500);

    if (page.url().includes("/auth") || page.url().includes("/signin")) {
      test.skip(true, "redirected to sign-in — admin fixture missing");
      return;
    }

    // Scope section header. The exact wording lives in the providers-client.
    await expect(
      page.getByRole("heading", { name: /Routing scopes/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Route Overrides section header.
    await expect(
      page.getByRole("heading", { name: /Route overrides/i }),
    ).toBeVisible();
  });
});
