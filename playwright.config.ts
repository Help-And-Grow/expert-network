import { defineConfig, devices } from "@playwright/test";

/**
 * When `PLAYWRIGHT_BASE_URL` is set (e.g. CI against production), tests hit that URL and no
 * local `webServer` is started. Otherwise defaults match `.github/workflows/ui-smoke.yml`.
 */
const prodBase = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "") ?? null;

const port = 3000;
const baseURL = prodBase ?? `http://localhost:${port}`;
const useWebServer = !prodBase;

/** Keep in sync with `.github/workflows/ui-smoke.yml` job `env` defaults. */
const defaultAuthSecret = "playwright-local-auth-secret-0123456789";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
  },
  ...(useWebServer
    ? {
        webServer: {
          command: `npx -y node@20 ./node_modules/next/dist/bin/next dev -p ${port} -H 0.0.0.0`,
          env: {
            ...process.env,
            NEXTAUTH_URL: `http://localhost:${port}`,
            AUTH_SECRET: process.env.AUTH_SECRET ?? defaultAuthSecret,
            DEV_AUTH_EMAIL: process.env.DEV_AUTH_EMAIL ?? "admin-smoke@localhost",
            DEV_AUTH_ROLE: process.env.DEV_AUTH_ROLE ?? "ADMIN",
          },
          url: `${baseURL}/api/health`,
          reuseExistingServer: !process.env.CI,
          stdout: "pipe",
          stderr: "pipe",
          timeout: 120_000,
        },
      }
    : {}),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
