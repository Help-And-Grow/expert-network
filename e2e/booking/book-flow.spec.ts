/**
 * Booking UI — public book page (no OAuth). See e2e/README.md.
 *
 * Expert discovery is no longer done via the API (GET /api/v1/experts is
 * auth-gated to prevent scraping). Supply a known expert ID via the
 * PLAYWRIGHT_EXPERT_ID env var to enable these tests in CI.
 */
import { test, expect } from "@playwright/test";

test.describe("Book a session (UI smoke)", () => {
  test("booking page loads for known expert (PLAYWRIGHT_EXPERT_ID)", async ({ page }) => {
    const expertId = process.env.PLAYWRIGHT_EXPERT_ID?.trim();
    test.skip(!expertId, "Set PLAYWRIGHT_EXPERT_ID to run this test");

    await page.goto(`/experts/${expertId}/book`);
    await expect(page.getByRole("heading", { name: "Schedule a meetup" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Online" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Offline" })).toBeVisible();
  });
});
