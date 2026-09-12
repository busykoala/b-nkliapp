import { describe, expect, test } from "vitest";
import { dialectRegionForBench, localBenchVoice } from "./dialect";

type Place = Parameters<typeof dialectRegionForBench>[0];

function place(overrides: Partial<Place> = {}): Place {
  return {
    id: "bench-test",
    latitude: 47.376,
    longitude: 8.541,
    locationName: "Zürich",
    locationCanton: "Zürich",
    sunnyNow: true,
    shadeCause: "frei",
    inForest: false,
    waterfront: false,
    viewLabels: [],
    ...overrides,
  };
}

describe("location-dependent bench voice", () => {
  test.each([
    ["Basel-Stadt", "Basel", 7.59, "basel"],
    ["Bern", "Bern", 7.45, "bern"],
    ["Zürich", "Zürich", 8.54, "zurich"],
    ["St. Gallen", "St. Gallen", 9.38, "northeast"],
    ["Luzern", "Luzern", 8.31, "central"],
    ["Valais", "Brig-Glis", 7.99, "wallis"],
    ["Valais", "Sion", 7.30, "romandy"],
    ["Vaud", "Lausanne", 6.63, "romandy"],
    ["Ticino", "Lugano", 8.95, "ticino"],
    ["Graubünden", "Davos", 9.82, "graubuenden"],
    ["Graubünden", "Scuol", 10.29, "romansh"],
    ["Graubünden", "Poschiavo", 10.06, "ticino"],
  ] as const)("maps %s / %s to a broad language region", (canton, municipality, longitude, expected) => {
    expect(dialectRegionForBench(place({ longitude, locationCanton: canton, locationName: municipality }))).toBe(expected);
  });

  test("uses geography before the less precise imported address", () => {
    expect(dialectRegionForBench(place({
      locationCanton: "Zürich",
      knowledge: { geography: { municipalityName: "Bern", municipalityId: "351", cantonName: "Bern", districtName: null, localityName: null, confidence: "high", sourceVersion: "test" } },
    }))).toBe("bern");
  });

  test("falls back to coordinates when place metadata is absent", () => {
    expect(dialectRegionForBench(place({ latitude: 46.006, longitude: 8.952, locationCanton: null, locationName: null }))).toBe("ticino");
    expect(dialectRegionForBench(place({ latitude: 46.519, longitude: 6.632, locationCanton: null, locationName: null }))).toBe("romandy");
  });

  test("keeps regional and playful voices deterministic and light-aware", () => {
    const bench = place({ sunnyNow: false, shadeCause: "vegetation" });
    const regional = localBenchVoice(bench, "regional");
    const playful = localBenchVoice(bench, "playful");
    expect(regional).toMatchObject({ region: "zurich", regionLabel: "Züridütsch", languageTag: "gsw-CH" });
    expect(regional.second).toContain("Schatte");
    expect(playful.first).not.toBe(regional.first);
    expect(localBenchVoice(bench, "regional")).toEqual(regional);
  });
});
