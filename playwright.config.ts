import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "npm run dev -- --port 3100",
    port: 3100,
    reuseExistingServer: false,
    env: {
      ...process.env,
      DATABASE_PATH: "/tmp/benchly-e2e-v2.sqlite",
      BENCHLY_SEED_DEMO: "true",
      CONTRIBUTOR_SECRET: "playwright-contributor-secret-with-more-than-32-characters",
      IP_HASH_SECRET: "playwright-ip-secret-with-more-than-32-characters",
      ADMIN_SESSION_SECRET: "playwright-admin-secret-with-more-than-32-characters",
    },
  },
  use: { baseURL: "http://localhost:3100", trace: "on-first-retry" },
  projects: [
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],
});
