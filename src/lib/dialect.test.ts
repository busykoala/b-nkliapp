import { describe, expect, test } from "vitest";
import { dialectRegionForBench, localBenchVoice, localLanguageForBench } from "./dialect";

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
    ["Valais", "Sion", 7.30, "frValais"],
    ["Vaud", "Lausanne", 6.63, "frVaud"],
    ["Genève", "Genève", 6.15, "frGeneva"],
    ["Neuchâtel", "Neuchâtel", 6.93, "frNeuchatel"],
    ["Jura", "Delémont", 7.35, "frJura"],
    ["Ticino", "Lugano", 8.95, "itSottoceneri"],
    ["Ticino", "Bellinzona", 9.02, "itSopraceneri"],
    ["Graubünden", "Davos", 9.82, "graubuenden"],
    ["Graubünden", "Scuol", 10.29, "rmVallader"],
    ["Graubünden", "Samedan", 9.87, "rmPuter"],
    ["Graubünden", "Savognin", 9.60, "rmSurmiran"],
    ["Graubünden", "Andeer", 9.42, "rmSutsilvan"],
    ["Graubünden", "Disentis/Mustér", 8.85, "rmSursilvan"],
    ["Graubünden", "Val Müstair", 10.37, "rmJauer"],
    ["Graubünden", "Poschiavo", 10.06, "itGraubuenden"],
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
    expect(dialectRegionForBench(place({ latitude: 46.006, longitude: 8.952, locationCanton: null, locationName: null }))).toBe("itSottoceneri");
    expect(dialectRegionForBench(place({ latitude: 46.519, longitude: 6.632, locationCanton: null, locationName: null }))).toBe("frVaud");
  });

  test("keeps local voices deterministic and light-aware", () => {
    const bench = place({ sunnyNow: false, shadeCause: "vegetation" });
    const voice = localBenchVoice(bench);
    expect(voice).toMatchObject({ region: "zurich", regionLabel: "Züridütsch", languageTag: "gsw-CH", uiLanguage: "de" });
    expect(voice.second).toContain("Schatte");
    expect(localBenchVoice(bench)).toEqual(voice);
  });

  test("switches the complete bench information to the local national language", () => {
    expect(localLanguageForBench(place({ locationCanton: "Vaud", locationName: "Lausanne", longitude: 6.63 }))).toBe("fr");
    expect(localLanguageForBench(place({ locationCanton: "Ticino", locationName: "Lugano", latitude: 46.01, longitude: 8.95 }))).toBe("it");
    expect(localLanguageForBench(place({ locationCanton: "Graubünden", locationName: "Scuol", latitude: 46.80, longitude: 10.29 }))).toBe("rm");
  });
});
