import { defineConfig, devices } from "@playwright/test";

const port = 3000;
const baseURL = `http://localhost:${port}`;

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
    video: "retain-on-failure",
  },
  webServer: {
    command: [
      "NEXTAUTH_URL=http://localhost:3000",
      "AUTH_SECRET=playwright-local-auth-secret-0123456789",
      "DEV_AUTH_EMAIL=admin-smoke@localhost",
      "DEV_AUTH_ROLE=ADMIN",
      "npx -y node@20 ./node_modules/next/dist/bin/next dev -p 3000 -H 0.0.0.0",
    ].join(" "),
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
