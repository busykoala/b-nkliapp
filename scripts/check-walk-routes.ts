/** Read-only release checks at public Swiss landmarks; never use personal origins. */
import Database from "better-sqlite3";
import { performance } from "node:perf_hooks";
import { pathSeconds } from "../src/lib/walking";
import type { WalkQuery } from "../src/lib/walks/model";

async function main() {
  const db = new Database(process.env.DATABASE_PATH ?? "data/benchly.sqlite", { readonly: true, fileMustExist: true });
  // Reuse a read-only connection instead of invoking app migrations or seeding.
  (globalThis as typeof globalThis & { benchlySqlite?: Database.Database }).benchlySqlite = db;
  const { discoverWalks } = await import("../src/lib/walks/provider");
  const { routeWalk } = await import("../src/lib/walking-provider");
  const places = [
    ["Spiez Hafen", 46.68844, 7.68949], ["Zürich HB", 47.3782, 8.5402],
    ["Sihlwald", 47.2688, 8.5575], ["Wimmis", 46.674, 7.629], ["Kandersteg", 46.495, 7.674],
  ] as const;
  try {
    for (const [label, latitude, longitude] of places) {
      const origin = db.prepare("SELECT id,latitude,longitude FROM benches WHERE active=1 AND abs(latitude-?)<.02 AND abs(longitude-?)<.03 ORDER BY abs(latitude-?)+abs(longitude-?)*.68 LIMIT 1").get(latitude, longitude, latitude, longitude) as { id: string; latitude: number; longitude: number } | undefined;
      if (!origin) { console.log(JSON.stringify({ place: label, error: "No public bench origin" })); continue; }
      for (const minutes of [30, 50, 120] as const) for (const shape of ["loop", "one-way"] as const) {
        const query: WalkQuery = { origin: { ...origin, kind: "station", label }, minutes, shape, speed: 4.2, light: "any", difficulty: "easy", time: new Date().toISOString() };
        const start = performance.now(), result = await discoverWalks(query), elapsedMs = Math.round(performance.now() - start);
        const chosen = result.suggestions[0];
        if (!chosen) { console.log(JSON.stringify({ place: label, minutes, shape, elapsedMs, error: result.message })); continue; }
        const direct = (await routeWalk({ points: [query.origin, chosen.bench] }, AbortSignal.timeout(15000), true))[0];
        console.log(JSON.stringify({ place: label, minutes, shape, elapsedMs, originBench: origin.id, bench: chosen.bench.id,
          actualMinutes: Math.round(chosen.durationSeconds / 60), shortestMinutes: Math.round(pathSeconds(direct, query.speed) / 60) * (shape === "loop" ? 2 : 1),
          ascent: Math.round(chosen.path.ascent), repeated: chosen.repeated, withinBudget: chosen.withinBudget,
          coverage: chosen.evidence.coverage, reasons: chosen.evidence.reasons, warnings: [...chosen.evidence.warnings, ...chosen.path.warnings],
          roadClasses: chosen.path.details.road_class, difficulty: chosen.path.details.hike_rating,
          ...(process.argv.includes("--geometry") ? { geometry: chosen.path.geometry, shortestGeometry: direct.geometry } : {}) }));
      }
    }
  } finally { db.close(); }
}
main().catch(() => { console.error("Walk release check failed; no personal route information logged."); process.exitCode = 1; });
