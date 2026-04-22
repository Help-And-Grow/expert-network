import { expect, test, type Page } from "@playwright/test";

async function signInAsLocalDev(page: Page, callbackUrl = "/booking") {
  const csrfResponse = await page.context().request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfJson = (await csrfResponse.json()) as { csrfToken: string };

  const response = await page.context().request.post("/api/auth/callback/dev-login", {
    form: {
      callbackUrl,
      csrfToken: csrfJson.csrfToken,
      json: "true",
      email: process.env.DEV_AUTH_EMAIL || "admin-smoke@localhost",
    },
  });

  expect(response.ok()).toBeTruthy();

  const sessionRes = await page.context().request.get("/api/auth/session");
  expect(sessionRes.ok()).toBeTruthy();
  const session = (await sessionRes.json()) as { user?: { email?: string | null } };
  expect(
    session?.user?.email,
    "dev-login must establish a session (check DATABASE_URL and Prisma for CI)",
  ).toBeTruthy();
}

async function signInWithProdE2E(page: Page, callbackUrl = "/booking") {
  const email = process.env.E2E_AUTH_EMAIL;
  const token = process.env.E2E_AUTH_TOKEN;
  if (!email || !token) {
    test.skip(true, "Set E2E_AUTH_EMAIL and E2E_AUTH_TOKEN for production smoke.");
  }

  const csrfResponse = await page.context().request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfJson = (await csrfResponse.json()) as { csrfToken: string };

  const response = await page.context().request.post("/api/auth/callback/e2e-login", {
    form: {
      email: email!,
      token: token!,
      callbackUrl,
      csrfToken: csrfJson.csrfToken,
      json: "true",
    },
  });

  expect(response.ok()).toBeTruthy();

  const sessionRes = await page.context().request.get("/api/auth/session");
  expect(sessionRes.ok()).toBeTruthy();
  const session = (await sessionRes.json()) as { user?: { email?: string | null } };
  expect(session?.user?.email).toBe(email!);
}

test.describe("local smoke", () => {
  // next dev compilation can take a while on the first request in CI
  test.setTimeout(120_000);

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
      page.getByText(/expert network for real conversations and trusted sessions/i),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Explore experts/i })).toBeVisible();
  });

  test("critical API boundaries return safe responses", async ({ request }) => {
    const voiceConfig = await request.get("/api/voice-chat/config");
    expect(voiceConfig.ok()).toBeTruthy();
    await expect(voiceConfig.json()).resolves.toMatchObject({
      mode: expect.any(String),
    });

    const unauthenticatedCheckout = await request.post("/api/bookings/checkout", {
      data: {},
    });
    expect(unauthenticatedCheckout.status()).toBe(401);

    const unauthenticatedFreeBooking = await request.post("/api/bookings/free", {
      data: {},
    });
    expect(unauthenticatedFreeBooking.status()).toBe(401);

    const unauthenticatedDebugRead = await request.get("/api/debug/users");
    expect([401, 404]).toContain(unauthenticatedDebugRead.status());

    const unauthenticatedDebugMutation = await request.post("/api/debug/clean");
    expect([401, 404]).toContain(unauthenticatedDebugMutation.status());

    const removedTranslateApi = await request.post("/api/voice-chat/translate", {
      data: { text: "hello", targetLanguage: "chinese" },
    });
    expect(removedTranslateApi.status()).toBe(404);
  });

  test("dev login reaches meetups and admin provider screens", async ({ page }) => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is required for auth-backed smoke.");

    await signInAsLocalDev(page, "/booking");
    await page.goto("/booking");
    await expect(page.getByText("My Meetups")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();

    await page.goto("/admin/ai-provider");
    await expect(page.getByText("AI Provider Control")).toBeVisible();
    await expect(page.getByLabel("Provider")).toBeVisible();
  });

  test("admin-only debug reads work after dev admin login", async ({ page }) => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is required for auth-backed smoke.");

    await signInAsLocalDev(page, "/booking");

    const response = await page.context().request.get("/api/debug/users");
    expect(response.ok()).toBeTruthy();
    const json = (await response.json()) as Record<string, unknown>;
    expect(json).toHaveProperty("User");
  });
});

test.describe("production smoke", () => {
  test("hidden e2e login reaches authenticated meetup flows", async ({ page }) => {
    test.skip(!process.env.PROD_BASE_URL, "PROD_BASE_URL is required for production smoke.");

    await signInWithProdE2E(page, "/booking");
    await page.goto("/booking");
    await expect(page.getByText("My Meetups")).toBeVisible({ timeout: 15_000 });
  });
});
