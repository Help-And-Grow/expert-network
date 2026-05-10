import { test, expect } from "@playwright/test";

/**
 * Sign-in page smoke. The Google button and magic-link form are only rendered
 * when their providers are advertised by `/api/auth/providers` — i.e. when
 * `GOOGLE_CLIENT_ID` / `EMAIL_SERVER_HOST` are set on the deployment under
 * test. CI runs the Playwright job against an ephemeral Next.js + Cloud SQL
 * pair without either, so we must check what's actually configured before
 * asserting on it. Branding (`Help & Grow`) is unconditional.
 */
test.describe("Auth — sign-in page (no session)", () => {
  test("shows branding and any configured sign-in methods", async ({ page, request }) => {
    // 1. Branding always renders.
    await page.goto("/auth/signin");
    await expect(page.getByText("Help & Grow", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // 2. Conditional buttons — query NextAuth's provider list, then assert only
    //    on the ones we expect to be visible. Avoids false negatives when
    //    Google / SMTP aren't configured on the deployment under test.
    const providersResponse = await request.get("/api/auth/providers");
    expect(providersResponse.ok()).toBeTruthy();
    const providers = (await providersResponse.json()) as Record<string, unknown>;
    const googleConfigured = Boolean(providers?.google);
    const magicLinkConfigured = Boolean(providers?.nodemailer);
    // Local dev / E2E shortcut. Set by `DEV_AUTH_EMAIL` on local + CI.
    const devLoginConfigured = Boolean(providers?.["dev-login"]);

    if (googleConfigured) {
      await expect(
        page.getByRole("button", { name: /Continue with Google/i }),
      ).toBeVisible();
    }

    if (magicLinkConfigured) {
      await expect(
        page.getByRole("button", { name: /Send Magic Link/i }),
      ).toBeVisible();
      await expect(page.getByPlaceholder(/you@example\.com/i)).toBeVisible();
    }

    // 3. Sanity check: at least one sign-in path must be available, otherwise
    //    the deployment is broken. CI runs with only `dev-login` enabled
    //    (DEV_AUTH_EMAIL set), production runs with Google + magic-link.
    expect(
      googleConfigured || magicLinkConfigured || devLoginConfigured,
    ).toBe(true);
  });
});
