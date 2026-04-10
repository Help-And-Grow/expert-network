import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PROD_BASE_URL;

if (!baseURL) {
  throw new Error("Set PROD_BASE_URL to the production site you want to verify.");
}

export default defineConfig({
  testDir: "./e2e",
  grep: /production smoke/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
