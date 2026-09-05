import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataCatalog } from "../src/data/catalog";

const helmTarget = resolve("deploy/charts/benchly/data-jobs.generated.json");
const helmGenerated = `${JSON.stringify({
  generatedFrom: `config/data-catalog.json@${dataCatalog.catalogVersion}`,
  timeZone: dataCatalog.timeZone,
  jobs: dataCatalog.jobs.map((job) => ({
    name: job.id,
    schedule: job.schedule,
    deadline: job.deadlineSeconds,
    args: [job.command, ...job.args],
    profile: job.profile,
  })),
}, null, 2)}\n`;
const runtimeTarget = resolve("src/data/runtime.generated.ts");
const runtimeGenerated = `// Generated from config/data-catalog.json. Do not edit by hand.\nexport const DATA_RUNTIME = ${JSON.stringify(dataCatalog.runtime, null, 2)} as const;\nexport const DATA_PROVIDERS = ${JSON.stringify(dataCatalog.providers, null, 2)} as const;\n`;

if (process.argv.includes("--check")) {
  if (readFileSync(helmTarget, "utf8") !== helmGenerated || readFileSync(runtimeTarget, "utf8") !== runtimeGenerated) {
    throw new Error("Generated data configuration is stale. Run `npm run data:catalog:generate`.");
  }
} else {
  writeFileSync(helmTarget, helmGenerated);
  writeFileSync(runtimeTarget, runtimeGenerated);
}
