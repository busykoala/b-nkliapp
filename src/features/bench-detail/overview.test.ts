import { describe, expect, it } from "vitest";
import type { Translator } from "@/i18n/types";
import type { BenchDetail, BenchProperty } from "@/lib/types";
import { testTranslator } from "@/test/translations";
import { benchFact } from "./facts";
import { accessSummary, comfortSummary, lightSummary, nearbyAmenities, quietSummary, validRating, viewSummary } from "./overview";
import { minuteClock, obstructionChart } from "./source-data";

const translate: Translator = testTranslator();
const fixture = (changes: Partial<BenchDetail> = {}) => ({
  properties: [], sunWindows: [], localMinutesNow: 720, sunnyNow: false, dayPhase: "day",
  knowledge: null, viewLabels: [], ratingBreakdown: null, ...changes,
}) as BenchDetail;
const fact = (key: BenchProperty["key"], value: BenchProperty["canonicalValue"], state: BenchProperty["evidenceState"] = "known") => ({
  key, label: "display only", value: "Ja", canonicalValue: value, evidenceState: state, source: "OpenStreetMap",
}) as BenchProperty;

describe("bench overview: resolved facts, useful intervals and scoped measurements", () => {
  it("reads canonical values, never translated labels or unresolved conflicting values", () => {
    const bench = fixture({ properties: [fact("backrest", false), fact("covered", true, "conflicting"), fact("armrest", null)] });
    expect(benchFact(bench, "backrest")).toMatchObject({ value: false, state: "known" });
    expect(benchFact(bench, "covered")).toMatchObject({ value: null, state: "conflicting" });
    expect(benchFact(bench, "armrest")).toMatchObject({ value: null, state: "unknown" });
    expect(comfortSummary(bench, translate)).toEqual({ value: "Ohne Rückenlehne", detail: undefined });
    expect(benchFact(fixture({ properties: [fact("seats", NaN)] }), "seats").state).toBe("unknown");
  });

  it("summarizes equipment once, with no confidence or verification badges", () => {
    const bench = fixture({ properties: [fact("backrest", true), fact("covered", false), fact("armrest", true), fact("seats", 3)] });
    expect(comfortSummary(bench, translate)).toEqual({ value: "Rückenlehne", detail: "Ohne Dach · Armlehnen · 3 Sitzplätze" });
    expect(comfortSummary(fixture(), translate).value).toBe("–");
  });

  it("ignores expired and invalid sun intervals and selects the next valid one", () => {
    const bench = fixture({ sunWindows: [{ start: "18:00", end: "16:00" }, { start: "14:00", end: "16:30" }, { start: "08:00", end: "10:00" }, { start: "25:00", end: "26:00" }] });
    expect(lightSummary(bench, translate)).toEqual({ value: "Schatten", detail: "Sonne 14:00–16:30" });
    expect(lightSummary({ ...bench, localMinutesNow: 23 * 60, dayPhase: "night" }, translate)).toEqual({ value: "Nacht", detail: undefined });
  });

  it("never equates a level bench space or missing route data with full accessibility", () => {
    const bench = fixture({ properties: [fact("wheelchair", true)] });
    expect(accessSummary(bench, translate).value).toBe("Ebener Platz am Bänkli");
    const withSteps = { ...bench, knowledge: { approach: { steps: true, surface: "asphalt" } } } as BenchDetail;
    expect(accessSummary(withSteps, translate).value).toBe("Stufen am Zugang");
    expect(accessSummary(fixture(), translate).value).toBe("–");
  });

  it("uses distinct view labels, not a model score presented as user stars", () => {
    expect(viewSummary(fixture({ viewLabels: ["Bergblick", "Seeblick", "Bergblick"] }), translate).value).toBe("Bergblick · Seeblick");
    expect(viewSummary(fixture(), translate).value).toBe("–");
  });

  it("requires a valid scored review and count", () => {
    expect(validRating(4.5, 2)).toBe(4.5);
    for (const [value, count] of [[4.5, 0], [NaN, 2], [0, 3], [6, 1], [null, 1]] as const) expect(validRating(value, count)).toBeNull();
    expect(quietSummary(fixture(), translate, String).value).toBe("–");
  });

  it.each([
    [1, "1 Ruhe-Bewertung"],
    [2, "2 Ruhe-Bewertungen"],
  ] as const)("formats %i quietness reviews with the real translator", (count, detail) => {
    const bench = fixture({
      ratingBreakdown: {
        overall: 4, view: null, comfort: null, quiet: 4,
        counts: { overall: count, view: 0, comfort: 0, quiet: count },
      },
    });
    expect(quietSummary(bench, translate, String)).toEqual({ value: "4 / 5", detail });
  });

  it("keeps current-period road and rail noise measurements separate", () => {
    const bench = fixture({ knowledge: { noise: [{ period: "day", mode: "road", value: 51, unit: "dB(A)" }, { period: "night", mode: "rail", value: 38, unit: "dB(A)" }] } as BenchDetail["knowledge"] });
    expect(quietSummary(bench, translate, String)).toEqual({ value: "51 dB(A)", detail: "Strasse · Lärmmodell" });
    expect(quietSummary({ ...bench, dayPhase: "night" }, translate, String).value).toBe("38 dB(A)");
  });

  it("sorts useful nearby facilities and never calls an ordinary fountain potable", () => {
    const bench = fixture({ knowledge: { amenities: [{ category: "waste_basket", distanceMeters: 2 }, { category: "toilets", distanceMeters: 120 }, { category: "fountain", distanceMeters: 40 }, { category: "drinking_water", distanceMeters: NaN }] } as BenchDetail["knowledge"] });
    expect(nearbyAmenities(bench).map(item => item.category)).toEqual(["fountain", "toilets"]);
    expect(bench.knowledge!.amenities[0].category).toBe("waste_basket"); // Never mutate the source list.
  });

  it("retains meaningful source-detail calculations without inventing missing openness", () => {
    expect(obstructionChart(20, null)).toMatchObject({ open: null, unknown: 80 });
    expect(obstructionChart(null, 0)).toMatchObject({ open: null, unknown: 100 });
    expect(obstructionChart(20, 30)).toMatchObject({ open: 50, unknown: 0 });
    expect(obstructionChart(80, 30)).toMatchObject({ open: null, inconsistent: true });
    expect(obstructionChart(null, null)).toBeNull();
    expect([0, 860.9, 1500].map(minuteClock)).toEqual(["00:00", "14:20", "23:59"]);
  });
});
