import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Local visual reviews use the full Chromium's current headless mode. It can
// use the machine's graphics backend instead of the software headless shell.
// Keep the original viewport, assertions, timeouts and Safari configuration.
export default defineConfig({
  ...base,
  projects: base.projects?.map(project => project.name === "mobile-chrome"
    ? { ...project, use: { ...project.use, channel: "chromium" } }
    : project),
});
