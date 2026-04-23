import fs from "fs";
import path from "path";

import { test, expect } from "@playwright/test";

/**
 * Requires a saved storage state file (cookies/session for your test user).
 * If the file is missing, this block is skipped — see e2e/README.md § Authentication.
 */
const authFile =
  process.env.PLAYWRIGHT_STORAGE_STATE ??
  path.join(process.cwd(), "e2e/.auth/user.json");

const describeWithStorage = fs.existsSync(authFile)
  ? test.describe
  : test.describe.skip;

describeWithStorage("Auth — authenticated session (storage state)", () => {
  test.use({ storageState: authFile });

  test("GET /api/auth/session includes user", async ({ request }) => {
    const res = await request.get("/api/auth/session");
    expect(res.ok()).toBeTruthy();
    const data = (await res.json()) as { user?: { email?: string | null } };
    expect(data.user, "Expected NextAuth session user").toBeTruthy();
  });

  test("My Bookings dashboard loads when signed in", async ({ page }) => {
    await page.goto("/booking");
    await expect(page.getByRole("heading", { name: /My Bookings/i })).toBeVisible({
      timeout: 20_000,
    });
  });
});
