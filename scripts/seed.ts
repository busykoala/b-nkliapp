import { sqlite } from "../src/db/client";

const result = sqlite.prepare("SELECT count(*) AS count FROM benches").get() as { count: number };
console.log(`Benchly contains ${result.count} benches.`);
