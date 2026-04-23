import { test, expect } from "@playwright/test";

test.describe("Marketing home", () => {
  test("loads hero and primary CTAs", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Help & Grow/i);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Learn by doing/i);
    await expect(page.locator('a[href="/auth/signin"]').first()).toBeVisible();
    await expect(page.locator('a[href="/discover"]').first()).toBeVisible();
  });
});
