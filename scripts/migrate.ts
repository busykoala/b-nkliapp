import { sqlite } from "../src/db/client";

const applied = sqlite.prepare("SELECT id, applied_at FROM _migrations ORDER BY applied_at").all();
console.log(`Benchly database ready: ${process.env.DATABASE_PATH ?? "./data/benchly.sqlite"}`);
console.table(applied);
