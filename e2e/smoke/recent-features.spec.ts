import { expect, test } from "@playwright/test";

/**
 * Smoke coverage for features landed in the past 1–2 weeks. Each test is
 * single-request or single-page-load so the spec stays under the CI budget
 * even running on every push to main.
 *
 * Linked work:
 *   - Canonical domain swap                  → docs/exec-plans/active/canonical-domain-swap.md
 *   - WeChat-Intl pivot back to Vercel       → docs/exec-plans/active/tencent-cloud-rollout.md
 *   - Discover stale-error fix               → src/lib/discover-match-storage.ts
 *   - Membership / tokens entitlement split  → src/app/api/trtc/token/route.ts
 *   - Semantic expert search Phase 4 ready   → src/app/api/admin/pgvector-backfill/route.ts
 *   - Public AI-match (/api/v1/match)        → src/app/api/v1/match/route.ts
 */

test.describe("Recent features — public health surface", () => {
  test("GET /api/health/origin returns the origin probe shape", async ({ request }) => {
    const res = await request.get("/api/health/origin");
    expect(res.ok(), `HTTP ${res.status()}`).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;

    // Shape contract — kept loose because the values change per origin (web vs WeChat backend).
    expect(body).toMatchObject({
      ok: true,
      wechat: expect.any(Boolean),
    });
    expect(body).toHaveProperty("region");
    expect(body).toHaveProperty("via");
    expect(body).toHaveProperty("from");
  });

  test("GET /api/tonconnect-manifest exposes the canonical app origin", async ({ request }) => {
    const res = await request.get("/api/tonconnect-manifest");
    expect(res.ok(), `HTTP ${res.status()}`).toBeTruthy();
    const body = (await res.json()) as { url?: string; name?: string; iconUrl?: string };

    expect(body.name).toBe("Help & Grow");
    expect(body.url).toMatch(/^https?:\/\//);
    expect(body.iconUrl).toMatch(/\/favicon\.ico$/);

    // When PLAYWRIGHT_BASE_URL is the canonical production URL, the manifest
    // should echo it (not the legacy expert-network.vercel.app alias). When
    // tests run against localhost we just verify the URL is well-formed.
    const base = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");
    if (base && /help-and-grow\.com/.test(base)) {
      expect(body.url).toContain("help-and-grow.com");
    }
  });
});

test.describe("Recent features — auth contracts on new routes", () => {
  test("POST /api/trtc/token requires session (401)", async ({ request }) => {
    const res = await request.post("/api/trtc/token", {
      data: { bookingId: "00000000-0000-0000-0000-000000000001" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status(), "TRTC token endpoint must reject anonymous calls").toBe(401);
  });

  test("POST /api/admin/pgvector-backfill requires admin (401/403)", async ({ request }) => {
    const res = await request.post("/api/admin/pgvector-backfill", {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    // requireAdmin rejects anonymous callers with 401, callers without ADMIN role with 403.
    expect([401, 403]).toContain(res.status());
  });
});

test.describe("Recent features — public AI-match (auth-free /v1)", () => {
  test("GET /api/v1/match requires the q parameter (400)", async ({ request }) => {
    const res = await request.get("/api/v1/match");
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });

  test("GET /api/v1/match?q=... returns a JSON response", async ({ request }) => {
    // Use a deterministic seed query. We don't assert specific experts —
    // production data drifts — only that the endpoint returns valid JSON
    // without 5xx. Pre-rank flag is handled inside the route.
    const res = await request.get("/api/v1/match?q=growth%20marketing");
    // 200 (matches found) or 200 with empty list — both fine. Anything 5xx is a regression.
    expect(res.status(), "Public match must not 5xx").toBeLessThan(500);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

test.describe("Recent features — Discover page loads (stale-error fix smoke)", () => {
  test("GET /discover renders without instant error banner", async ({ page }) => {
    const response = await page.goto("/discover", { waitUntil: "domcontentloaded" });
    expect(response?.ok(), `HTTP ${response?.status()}`).toBeTruthy();

    // After the stale-error fix, a fresh page load should not show the
    // "Sorry, something went wrong" bubble that was being persisted from
    // a prior failed match. (The fix lives in src/lib/discover-match-storage.ts:
    // `stripTransientTail` drops trailing transient-error rows + their user
    // prompts before persisting.)
    const errorBubble = page.getByText(/Sorry, something went wrong/i);
    await expect(errorBubble).toHaveCount(0);
  });
});
