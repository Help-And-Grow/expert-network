import { expect, test } from "@playwright/test";

/**
 * Phase 2 of guest-booking — magic-link booking management.
 * See docs/exec-plans/active/guest-booking.md §5.4.
 *
 * The HMAC-signed token (lib/booking-token.ts) gates GET / PATCH on
 * /api/bookings/{id} so a guest can view + cancel their own booking from
 * the link in their confirmation email — no sign-in required.
 *
 * Without a real booking we can't test the happy path against production,
 * but we CAN lock down the failure modes that protect the system: malformed
 * tokens, mismatched booking IDs, and missing auth all reject cleanly.
 */

const FAKE_BOOKING_ID = "cmnv00000000000000000000z"; // cuid-shaped, won't exist
const GARBAGE_TOKEN = "not-a-real-token-just-junk";

test.describe("Guest booking — Phase 2 (magic-link manage)", () => {
  test("/bookings/{id}/manage page loads without redirecting to sign-in", async ({
    page,
  }) => {
    const res = await page.goto(
      `/bookings/${FAKE_BOOKING_ID}/manage?t=${GARBAGE_TOKEN}`,
      { waitUntil: "domcontentloaded" },
    );
    expect(res?.ok(), `HTTP ${res?.status()}`).toBeTruthy();

    // Critical: this path must NOT bounce to /auth/signin. Phase 2's whole
    // point is that guests can manage their booking without an account.
    expect(page.url()).toContain(`/bookings/${FAKE_BOOKING_ID}/manage`);
    expect(page.url()).not.toContain("/auth/signin");
  });

  test("manage page surfaces a clear error for a bad token (no PII leak)", async ({
    page,
  }) => {
    await page.goto(
      `/bookings/${FAKE_BOOKING_ID}/manage?t=${GARBAGE_TOKEN}`,
      { waitUntil: "networkidle" },
    );

    // Either:
    //   - the booking doesn't exist (404 from API → "Booking not found")
    //   - or the token is invalid (401 → "expired or is invalid")
    // Both are acceptable error surfaces; we just need a friendly message
    // and NO disclosure of internal details.
    const errorRegion = page.getByText(
      /(couldn.?t open this link|not found|invalid|expired)/i,
    );
    await expect(errorRegion.first()).toBeVisible({ timeout: 8000 });

    // Negative assertion: should never leak the token, AUTH_SECRET, or
    // a stack trace to the page.
    const html = await page.content();
    expect(html).not.toContain("AUTH_SECRET");
    expect(html.toLowerCase()).not.toContain("at hashbookingtoken");
    expect(html.toLowerCase()).not.toContain("authsecret");
  });

  test("API: GET /api/bookings/{id} without token + without session → 401 (or 404 for unknown id)", async ({
    request,
  }) => {
    const res = await request.get(`/api/bookings/${FAKE_BOOKING_ID}`);
    // 404 if the booking doesn't exist (the GET handler checks existence
    // before auth; that's correct because it lets the auth path still 401
    // for KNOWN bookings without leaking which IDs exist via timing).
    // 401 if the booking somehow exists. We accept both for a fake id.
    expect([401, 404]).toContain(res.status());
  });

  test("API: GET /api/bookings/{id}?t=<garbage> rejects without 5xx", async ({
    request,
  }) => {
    const res = await request.get(
      `/api/bookings/${FAKE_BOOKING_ID}?t=${GARBAGE_TOKEN}`,
    );
    // Token verification doesn't even run for nonexistent bookings (404
    // wins); the important guarantee is no 5xx surface for malformed input.
    expect(res.status()).toBeLessThan(500);
  });

  test("API: PATCH /api/bookings/{id} without token + without session → 401", async ({
    request,
  }) => {
    const res = await request.patch(`/api/bookings/${FAKE_BOOKING_ID}`, {
      data: { action: "cancel" },
      headers: { "Content-Type": "application/json" },
    });
    expect([401, 404]).toContain(res.status());
  });

  test("API: PATCH with garbage token cannot cancel a booking", async ({
    request,
  }) => {
    const res = await request.patch(
      `/api/bookings/${FAKE_BOOKING_ID}?t=${GARBAGE_TOKEN}`,
      {
        data: { action: "cancel" },
        headers: { "Content-Type": "application/json" },
      },
    );
    // Must NOT be 200 — the whole point of HMAC validation is that a forged
    // token never authorizes mutation. 401/404 are both acceptable.
    expect(res.status()).not.toBe(200);
    expect(res.status()).toBeLessThan(500);
  });
});
