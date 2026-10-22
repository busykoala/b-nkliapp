import { describe, expect, it } from "vitest";
import { eligibleMiniatures, miniatureGroupSizes, sceneLocalDate, scenePoem, selectMiniature } from "./scene-poetry";
import { sourceBench } from "@/test/bench-source-fixture";
import { testMessages, testTranslator } from "@/test/translations";
import { DIALECT_PACK_MESSAGES } from "@/i18n/dialects/packs.generated";

describe("authored scene miniatures", () => {
  it("has distinct complete miniatures in all languages and generated dialect packs", () => {
    const catalogs = ["de", "fr", "it", "rm"].map(language => testMessages(language as "de").poetry).concat(Object.values(DIALECT_PACK_MESSAGES).map(pack => pack.poetry));
    for (const catalog of catalogs) for (const [group, count] of Object.entries(miniatureGroupSizes)) {
      const lines = Object.values(catalog.miniatures[group as keyof typeof catalog.miniatures]);
      expect(lines).toHaveLength(count);
      expect(new Set(lines).size).toBe(count);
      for (const line of lines) { expect(line).toMatch(/[.!?]$/); expect(line).not.toMatch(/\{.*\}|noch unbekannt|noch erkundet|garantiert/); }
    }
  });
  it("uses the Swiss calendar day across UTC midnight and DST", () => {
    expect(sceneLocalDate({ skyObservedAt: "2026-09-20T22:30:00Z" })).toBe("2026-09-21");
    expect(sceneLocalDate({ skyObservedAt: "2026-01-20T23:30:00Z" })).toBe("2026-01-21");
    expect(sceneLocalDate({ skyObservedAt: "invalid" })).toBe("undated");
  });
  it("never selects sunny landscapes in rain, snow, darkness or unknown weather", () => {
    const bench = sourceBench();
    expect(eligibleMiniatures({ ...bench, weather: { ...bench.weather!, precipitationType: "rain" } })).toEqual(["rain"]);
    expect(eligibleMiniatures({ ...bench, weather: { ...bench.weather!, precipitationType: "snow" } })).toEqual(["snow"]);
    expect(eligibleMiniatures({ ...bench, dayPhase: "night" })).toEqual(["night"]);
    expect(eligibleMiniatures({ ...bench, dayPhase: "dusk" })).toEqual(["twilight"]);
    expect(eligibleMiniatures({ ...bench, sunnyNow: true, weather: null })).not.toContain("sun");
    expect(eligibleMiniatures({ ...bench, sunnyNow: true, weather: { ...bench.weather!, cloudCover: .9 } })).not.toContain("sun");
    expect(eligibleMiniatures({ ...bench, waterfront: false, inForest: false, viewLabels: [] })).not.toContain("water");
  });
  it("is deterministic within a scene and varies across visits without sentence assembly", () => {
    const bench = sourceBench({ dayPhase: "night" });
    const t = testTranslator();
    expect(scenePoem(bench, t)).toEqual(scenePoem({ ...bench, localMinutesNow: 800 }, t));
    const passages = new Set(Array.from({ length: 8 }, (_, day) => scenePoem({ ...bench, skyObservedAt: `2026-09-${20 + day}T22:30:00Z` }, t).text));
    expect(passages.size).toBe(8);
    const selected = selectMiniature(bench);
    expect(scenePoem(bench, t).text).toBe(t(selected.key));
  });
});
