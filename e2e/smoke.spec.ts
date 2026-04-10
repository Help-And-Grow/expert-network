import { expect, test, type Page } from "@playwright/test";

async function signInAsLocalDev(page: Page, callbackUrl = "/booking") {
  await page.goto(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await expect(page.getByRole("button", { name: "Continue as local dev" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Continue as local dev" }).click();
}

test.describe("local smoke", () => {
  test("landing page and public health endpoints are reachable", async ({ page, request }) => {
    const health = await request.get("/api/health");
    expect(health.ok()).toBeTruthy();
    await expect(health.json()).resolves.toEqual({ ok: true, service: "expert-network" });

    const trpcHealth = await request.get("/api/trpc/health?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D");
    expect(trpcHealth.ok()).toBeTruthy();
    await expect(trpcHealth.text()).resolves.toContain('"ok":true');

    await page.goto("/");
    await expect(page).toHaveTitle(/Help & Grow/i);
    await expect(
      page.getByRole("heading", { name: /Learn by doing\. Grow by helping\./i }),
    ).toBeVisible();
    await expect(
      page.getByText(/AI Native Expert Network/i).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Get Started/i })).toBeVisible();
  });

  test("dev login reaches bookings and admin provider screens", async ({ page }) => {
    await signInAsLocalDev(page, "/booking");
    await page.waitForURL("**/booking");
    await page.reload();
    await expect(page.getByRole("heading", { name: "My Bookings" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();

    await page.goto("/admin/ai-provider");
    await expect(page.getByText("AI Provider Control")).toBeVisible();
    await expect(page.getByLabel("Provider")).toBeVisible();
  });
});
