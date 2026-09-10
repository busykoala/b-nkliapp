import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDatabase = process.env.BENCHLY_E2E_DATABASE ?? join(tmpdir(), `benchly-e2e-${process.pid}.sqlite`);
process.env.BENCHLY_E2E_DATABASE = testDatabase;
const production = process.env.PLAYWRIGHT_PRODUCTION === "1";
const baseURL = production ? "https://localhost:3100" : "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  // Let Playwright distribute individual tests instead of whole spec files.
  // Several suites intentionally contain many scenarios, so file-level sharding
  // left one release runner doing almost the entire mobile-map suite.
  fullyParallel: Boolean(process.env.CI),
  // Software-rendered mobile browsers and CPU throttling need an unshared CPU.
  workers: process.env.CI ? 1 : 4,
  reporter: process.env.CI ? "list" : undefined,
  webServer: {
    command: production ? "tsx scripts/serve-production-tests.ts" : "npm run dev -- --port 3100",
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
      BENCHLY_JOURNEY_TEST_FIXTURES: "true",
      BENCHLY_E2E_NOW: "2026-09-05T12:00:00+02:00",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=tsx --import=${join(process.cwd(), "scripts/journey-test-providers.ts")}`,
    },
  },
  use: {
    baseURL,
    ignoreHTTPSErrors: production,
    // Keep DOM/network diagnostics without recording every WebGL animation frame.
    trace: { mode: "retain-on-failure", screenshots: false, snapshots: true, sources: true },
    screenshot: "only-on-failure",
  },
  projects: [
    // Hosted runners render WebGL in software. Keep mobile viewports and touch
    // input at 1x in CI; the performance test explicitly retains native density.
    { name: "mobile-chrome", use: { ...devices["Pixel 7"], ...(process.env.CI ? { deviceScaleFactor: 1 } : {}) } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"], browserName: "webkit", ...(process.env.CI ? { deviceScaleFactor: 1 } : {}) } },
  ],
});
