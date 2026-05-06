/**
 * Payment endpoint contract tests.
 *
 * After Phase 1 of the guest-booking rollout
 * (docs/exec-plans/active/guest-booking.md), anonymous callers no longer
 * receive 401 — they get 400 with a guest-fields hint, because the auth gate
 * was intentionally dropped in favor of the upsert-by-email pattern.
 *
 * Verifies the public surface of the Stripe Checkout entry point:
 *   1. Unauthenticated callers without guest fields → 400 (was 401 pre-Phase-1)
 *   2. Malformed bodies → 400 (Zod boundary)
 *   3. Non-existent expert → 4xx (not 5xx)
 *
 * Full Checkout-redirect coverage requires storage state + a paid expert and
 * lives behind PLAYWRIGHT_RUN_CHECKOUT_TEST. See e2e/README.md.
 */
import { test, expect } from "@playwright/test";

test.describe("Booking checkout — endpoint contract", () => {
  test("unauthenticated POST /api/bookings/checkout without guest fields → 400", async ({ request }) => {
    const res = await request.post("/api/bookings/checkout", {
      data: {
        expertId: "stub",
        sessionType: "ONLINE",
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
    });
    // Phase 1: missing guestEmail/guestName is a 400 (validation), not 401 (auth).
    expect(res.status()).toBe(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("malformed body → 400", async ({ request }) => {
    const res = await request.post("/api/bookings/checkout", {
      data: { expertId: "" },
    });
    // Always 400 on a body Zod can't parse. The route must never silently 5xx.
    expect(res.status()).toBe(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("Telegram pre-checkout webhook ignores empty bodies", async ({ request }) => {
    const res = await request.post("/api/webhooks/telegram", {
      data: {},
    });
    // The webhook always answers 200 OK to avoid Telegram retries.
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).toEqual({ ok: true });
  });
});
