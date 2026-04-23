import { test, expect } from "@playwright/test";

test.describe("Auth — sign-in page (no session)", () => {
  test("shows Google, magic link, and branding", async ({ page }) => {
    await page.goto("/auth/signin");
    await expect(page.getByText("Help & Grow", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Send Magic Link/i })).toBeVisible();
    await expect(page.getByPlaceholder(/you@example\.com/i)).toBeVisible();
  });
});
