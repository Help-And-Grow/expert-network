import { test, expect } from "@playwright/test";

/**
 * HTTP contracts for payment-related routes (no OAuth).
 * Mirrors manual Chrome MCP checks: unauthenticated clients get 401, public routes stay open.
 */
test.describe("Public + auth-gated API contracts", () => {
  test("GET /api/health", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { ok?: boolean; service?: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("expert-network");
  });

  test("GET /api/v1/experts requires session (401)", async ({ request }) => {
    // Auth was added to /api/v1/experts to prevent unauthenticated scraping.
    // WeChat / Telegram clients always include their platform token so they
    // are unaffected; unauthenticated callers should receive 401.
    const res = await request.get("/api/v1/experts?limit=5");
    expect(res.status()).toBe(401);
  });

  test("GET /api/experts requires session (401)", async ({ request }) => {
    const res = await request.get("/api/experts");
    expect(res.status()).toBe(401);
  });

  test("POST /api/bookings/checkout — anonymous callers must provide guest fields (400, was 401)", async ({ request }) => {
    // Phase 1 of guest-booking dropped the 401 gate. Anonymous callers must
    // now supply guestEmail + guestName; missing them is a validation error.
    // The wechat-pay and pay-remainder endpoints below still 401 — those
    // weren't in Phase 1 scope.
    const res = await request.post("/api/bookings/checkout", {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/bookings/wechat-pay requires session (401)", async ({ request }) => {
    const res = await request.post("/api/bookings/wechat-pay", {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/bookings/[id]/pay-remainder requires session (401)", async ({ request }) => {
    const fakeId = "00000000-0000-0000-0000-000000000001";
    const res = await request.post(`/api/bookings/${fakeId}/pay-remainder`, {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });
});
