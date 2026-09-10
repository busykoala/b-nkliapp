import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: { reporter: ["text", "json-summary"] },
  },
  resolve: { alias: { "next-intl/server": new URL("./src/test/next-intl-server.ts", import.meta.url).pathname, "@": new URL("./src", import.meta.url).pathname, "server-only": new URL("./src/test/server-only.ts", import.meta.url).pathname } },
});
