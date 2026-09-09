import nextEnv from "@next/env";

// Use the same database configuration as the subsequent Next.js build.
nextEnv.loadEnvConfig(process.cwd());
const { sqlite } = await import("../src/db/client");

const applied = sqlite.prepare("SELECT id, applied_at FROM _migrations ORDER BY applied_at").all();
console.log(`Benchly database ready: ${process.env.DATABASE_PATH ?? "./data/benchly.sqlite"}`);
console.table(applied);
