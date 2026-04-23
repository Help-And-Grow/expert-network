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

  test("GET /api/v1/experts returns list", async ({ request }) => {
    const res = await request.get("/api/v1/experts?limit=5");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { experts?: unknown[] };
    expect(Array.isArray(body.experts)).toBe(true);
  });

  test("POST /api/bookings/checkout requires session (401)", async ({ request }) => {
    const res = await request.post("/api/bookings/checkout", {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
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
