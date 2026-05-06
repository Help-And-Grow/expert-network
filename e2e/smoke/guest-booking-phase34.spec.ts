import { expect, test } from "@playwright/test";

/**
 * Phase 3 + 4 of the guest-booking rollout — see
 * docs/exec-plans/active/guest-booking.md.
 *
 * Phase 3: account-linking polish (one-time welcome banner — covered as a
 * unit/component test more easily than e2e; the smoke here just confirms
 * /booking still serves a 200 with the new banner import in place).
 *
 * Phase 4: hardening
 *   - Disposable-email blocklist on guest checkout
 *   - Orphan-user reaper Inngest function (no public surface; covered via
 *     unit test of the pure logic, not e2e)
 *
 * Tests run against PLAYWRIGHT_BASE_URL — production canonical URL on CI.
 */

const BOOKABLE_EXPERT_ID = "cmnv88x16000004lbw2n2vj1s"; // William Ong, published

test.describe("Guest booking — Phase 4 disposable-email blocklist", () => {
  test("POST /api/bookings/free with @mailinator.com → 400 with helpful message", async ({ request }) => {
    const res = await request.post("/api/bookings/free", {
      data: {
        expertId: BOOKABLE_EXPERT_ID,
        sessionType: "ONLINE",
        startTime: "2099-01-01T10:00:00.000Z",
        endTime: "2099-01-01T10:30:00.000Z",
        guestName: "Throwaway Test",
        guestEmail: "throwaway-abuse@mailinator.com",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string; details?: Record<string, string[]> };
    // Either the top-level error or the field-level details should mention
    // "disposable" or "permanent" so the user understands why.
    const blob = JSON.stringify(body).toLowerCase();
    expect(blob).toMatch(/disposable|permanent|throwaway/);
  });

  test("POST /api/bookings/checkout with @yopmail.fr → 400", async ({ request }) => {
    const res = await request.post("/api/bookings/checkout", {
      data: {
        expertId: BOOKABLE_EXPERT_ID,
        sessionType: "ONLINE",
        startTime: "2099-01-01T10:00:00.000Z",
        endTime: "2099-01-01T10:30:00.000Z",
        guestName: "Throwaway Test",
        guestEmail: "abuse@yopmail.fr",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/bookings/free with a real-looking email passes the blocklist (validation moves past disposable check)", async ({ request }) => {
    // The booking will still fail downstream because the slot is fictitious,
    // but the failure must NOT be the disposable-email validator. Anything
    // other than 400 with a "disposable" message proves the blocklist let
    // a normal address through.
    const res = await request.post("/api/bookings/free", {
      data: {
        expertId: BOOKABLE_EXPERT_ID,
        sessionType: "ONLINE",
        startTime: "2099-01-01T10:00:00.000Z",
        endTime: "2099-01-01T10:30:00.000Z",
        guestName: "Real User",
        guestEmail: "test+phase4-smoke@example.com",
      },
      headers: { "Content-Type": "application/json" },
    });
    // Could be 4xx for various reasons (price > 0, slot conflict, etc.)
    // but if it hits the disposable check, the response body would mention it.
    if (res.status() === 400) {
      const body = (await res.json()) as { error?: string };
      expect(body.error?.toLowerCase() ?? "").not.toMatch(/disposable|permanent|throwaway/);
    }
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe("Guest booking — Phase 3 dashboard banner", () => {
  test("GET /booking renders without 5xx (banner is mounted client-side, hidden until userData arrives)", async ({ page }) => {
    // Anonymous visitor: the banner stays hidden because userId is null. We
    // only smoke that the page hasn't regressed by importing GuestMergeBanner.
    const res = await page.goto("/booking", { waitUntil: "domcontentloaded" });
    expect(res?.ok() || res?.status() === 401, `HTTP ${res?.status()}`).toBeTruthy();
    expect(res?.status()).toBeLessThan(500);
  });
});
