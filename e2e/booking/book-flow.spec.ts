/**
 * Booking UI — public book page (no OAuth). See e2e/README.md.
 */
import { test, expect } from "@playwright/test";

test.describe("Book a session (UI smoke)", () => {
  test("booking page loads for first published expert from v1 API", async ({
    page,
    request,
  }) => {
    const list = await request.get("/api/v1/experts?limit=1");
    const listText = await list.text();
    expect(list.ok(), `HTTP ${list.status()} — ${listText}`).toBeTruthy();
    const body = JSON.parse(listText) as { experts?: Array<{ id: string }> };
    const expertId = body.experts?.[0]?.id;
    test.skip(!expertId, "No published experts in this environment");

    await page.goto(`/experts/${expertId}/book`);
    await expect(page.getByRole("heading", { name: "Book a Session" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Online" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Offline" })).toBeVisible();
  });

  test("optional: fixed expert id via PLAYWRIGHT_EXPERT_ID", async ({ page }) => {
    const expertId = process.env.PLAYWRIGHT_EXPERT_ID?.trim();
    test.skip(!expertId, "Set PLAYWRIGHT_EXPERT_ID to run this targeted test");

    await page.goto(`/experts/${expertId}/book`);
    await expect(page.getByRole("heading", { name: "Book a Session" })).toBeVisible();
  });
});
