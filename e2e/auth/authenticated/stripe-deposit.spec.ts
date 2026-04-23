import fs from "fs";
import path from "path";

import { test, expect } from "@playwright/test";

/**
 * Optional: reach Stripe Checkout (PayNow / card on Stripe) without completing payment.
 * Requires: valid storage state + paid expert + PLAYWRIGHT_RUN_CHECKOUT_TEST=1
 */
const authFile =
  process.env.PLAYWRIGHT_STORAGE_STATE ??
  path.join(process.cwd(), "e2e/.auth/user.json");

const runCheckoutProbe =
  process.env.PLAYWRIGHT_RUN_CHECKOUT_TEST === "1" && fs.existsSync(authFile);

const describeCheckout = runCheckoutProbe ? test.describe : test.describe.skip;

describeCheckout("Payments — Stripe deposit redirect (opt-in)", () => {
  test.use({ storageState: authFile });

  test("Pay Deposit opens Stripe Checkout", async ({ page }) => {
    const expertId = process.env.PLAYWRIGHT_EXPERT_ID?.trim();
    test.skip(!expertId, "Set PLAYWRIGHT_EXPERT_ID to a paid expert (non-zero price)");

    await page.goto(`/experts/${expertId}/book`);
    await expect(page.getByRole("heading", { name: "Book a Session" })).toBeVisible();

    await page.locator("button[data-day]:not([disabled])").first().click();

    await expect(page.getByRole("button", { name: /\d{1,2}:\d{2}/ }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: /\d{1,2}:\d{2}/ }).first().click();

    const payButton = page.getByRole("button", { name: /Pay Deposit/i });
    await expect(payButton).toBeVisible({ timeout: 15_000 });
    await expect(payButton).toBeEnabled();

    await Promise.all([
      page.waitForURL(/checkout\.stripe\.com|stripe\.com\/checkout/i, { timeout: 90_000 }),
      payButton.click(),
    ]);

    await expect(page).toHaveURL(/stripe\.com/i);
  });
});
