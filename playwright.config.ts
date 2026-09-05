import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDatabase = join(tmpdir(), `benchly-e2e-${process.pid}.sqlite`);
const production = process.env.PLAYWRIGHT_PRODUCTION === "1";
const baseURL = production ? "https://localhost:3100" : "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: production ? "node scripts/serve-production-tests.mjs" : "npm run dev -- --port 3100",
    url: baseURL,
    ignoreHTTPSErrors: production,
    reuseExistingServer: false,
    env: {
      ...process.env,
      DATABASE_PATH: testDatabase,
      BENCHLY_SEED_DEMO: "true",
      CONTRIBUTOR_SECRET: "playwright-contributor-secret-with-more-than-32-characters",
      RATE_LIMIT_SECRET: "playwright-rate-limit-secret-with-more-than-32-characters",
      USER_SESSION_SECRET: "playwright-user-session-secret-with-more-than-32-characters",
      ADMIN_SESSION_SECRET: "playwright-admin-secret-with-more-than-32-characters",
      BENCH_VERIFICATION_THRESHOLD: "3",
      BENCHLY_DISABLE_ELEVATION_FETCH: "true",
    },
  },
  use: { baseURL, ignoreHTTPSErrors: production, trace: "on-first-retry" },
  projects: [
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"], browserName: "webkit" } },
  ],
});
