/** An offline editorial matrix, explicitly synthetic; never writes visitor content. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { sourceBench } from "../src/test/bench-source-fixture";
import { testTranslator, testMessages } from "../src/test/translations";
import { scenePoem, selectMiniature, miniatureGroupSizes, type MiniatureGroup } from "../src/lib/scene-poetry";
import type { BenchDetail } from "../src/lib/types";

const root = resolve(process.argv[2] ?? "test-results/ui-watercolor-guide");
const base = sourceBench({ skyObservedAt: "2026-10-21T10:00:00Z", sunnyNow: null, viewLabels: [], inForest: false, waterfront: false, properties: [] });
const weather = (changes: Partial<NonNullable<BenchDetail["weather"]>>) => ({ ...base.weather!, ...changes });
const cases: Array<{ title: string; group: MiniatureGroup; changes: Partial<BenchDetail> }> = [
  { title: "Spärliche Ortsdaten", group: "pause", changes: { weather: null } },
  { title: "Sonne bei wenig Wolken", group: "sun", changes: { sunnyNow: true, weather: weather({ cloudCover: .1 }) } },
  { title: "Schatten am Platz", group: "shade", changes: { sunnyNow: false } },
  { title: "Regen im Ort", group: "rain", changes: { weather: weather({ precipitationType: "rain" }) } },
  { title: "Schneefall", group: "snow", changes: { weather: weather({ precipitationType: "snow" }) } },
  { title: "Nacht ohne behauptete Sterne", group: "night", changes: { dayPhase: "night", moonVisible: false } },
  { title: "Bekannter Bergblick", group: "mountains", changes: { viewLabels: ["Bergblick"] } },
  { title: "Am Wasser", group: "water", changes: { waterfront: true } },
  { title: "Im Wald", group: "forest", changes: { inForest: true } },
  { title: "Herbst ohne erfundene Bäume", group: "autumn", changes: {} },
  { title: "Frühlingsanfang", group: "spring", changes: { season: "spring" } },
  { title: "Sommertag ohne Wetterdaten", group: "summer", changes: { season: "summer", weather: null } },
  { title: "Winter ohne behaupteten Schnee", group: "winter", changes: { season: "winter" } },
  { title: "Morgendämmerung", group: "twilight", changes: { dayPhase: "dawn" } },
  { title: "Abenddämmerung", group: "twilight", changes: { dayPhase: "dusk", skyObservedAt: "2026-10-22T16:00:00Z" } },
  { title: "Regen vor Berglandschaft", group: "rain", changes: { viewLabels: ["Bergblick"], weather: weather({ precipitationType: "rain" }), skyObservedAt: "2026-10-23T10:00:00Z" } },
  { title: "Bewölkter Platz mit möglicher direkter Sonne", group: "pause", changes: { sunnyNow: true, weather: weather({ cloudCover: .95 }) } },
  { title: "Schneeregen", group: "rain", changes: { weather: weather({ precipitationType: "mixed" }), skyObservedAt: "2026-10-24T10:00:00Z" } },
  { title: "Nacht am Wasser", group: "night", changes: { dayPhase: "night", waterfront: true, skyObservedAt: "2026-10-25T20:00:00Z" } },
  { title: "Wiederbesuch am nächsten Tag", group: "forest", changes: { inForest: true, skyObservedAt: "2026-10-22T10:00:00Z" } },
];
const used = new Set<string>();
let forestBenchId: string | undefined;
const samples = cases.map(({ title, group, changes }, index) => {
  let bench = { ...base, ...changes };
  // Select a synthetic ID that illustrates the declared eligible theme.
  for (let attempt = 0; attempt < 1000; attempt++) {
    bench = { ...bench, id: index === 19 && forestBenchId ? forestBenchId : `editorial-fixture-${index}-${attempt}` };
    const current = selectMiniature(bench);
    const later = index === 8 ? selectMiniature({ ...bench, skyObservedAt: "2026-10-22T10:00:00Z" }) : null;
    if (current.group === group && !used.has(current.key) && (!later || later.group === group)) break;
  }
  const selection = selectMiniature(bench);
  if (selection.group !== group || used.has(selection.key)) throw new Error(`No distinct matching fixture: ${title}`);
  if (index === 8) forestBenchId = bench.id;
  used.add(selection.key);
  return { title, fixtureId: bench.id, ...selection, timestamp: bench.skyObservedAt, texts: Object.fromEntries((["de", "fr", "it", "rm"] as const).map(language => [language, scenePoem(bench, testTranslator(language)).text])) };
});
const catalogs = Object.fromEntries((["de", "fr", "it", "rm"] as const).map(language => [language, testMessages(language).poetry]));
await mkdir(root, { recursive: true });
await writeFile(join(root, "poetry-review.json"), JSON.stringify({ status: "authored-and-editorially-inspected", independentNativeReview: false, selection: "complete passages, Swiss scene date, known eligible context, stable while mounted", groupSizes: miniatureGroupSizes, miniaturesPerLanguage: Object.values(miniatureGroupSizes).reduce((a, b) => a + b, 0), samples, catalogs }, null, 2) + "\n");
console.log(`Wrote ${samples.length} editorial scenarios with all four language versions.`);
