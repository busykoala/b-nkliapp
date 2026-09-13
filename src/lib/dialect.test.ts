import { describe, expect, test } from "vitest";
import { dialectRegionForBench, localBenchVoice, localLanguageForBench } from "./dialect";
import { resolveDialect } from "./dialects/resolve";

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
    dayPhase: "day",
    ...overrides,
  };
}

function official(municipalityName: string, localityName: string | null, cantonName: string, overrides: Partial<Place> = {}): Place {
  return place({
    locationName: "stale imported label",
    locationCanton: null,
    knowledge: { geography: { municipalityName, municipalityId: "fixture", cantonName, districtName: null, localityName, confidence: "high", sourceVersion: "swissBOUNDARIES3D-2026" } },
    ...overrides,
  });
}

describe("versioned dialect resolver", () => {
  test.each([
    ["Düdingen", null, "Fribourg", "fr-sensler"], ["Tafers", null, "Fribourg", "fr-sensler"], ["Plaffeien", null, "Fribourg", "fr-sensler"],
    ["Murten", null, "Fribourg", "fr-seeland"], ["Kerzers", null, "Fribourg", "fr-seeland"], ["Jaun", "Im Fang", "Fribourg", "fr-jaun"],
    ["Gurmels", "Kleingurmels", "Fribourg", "fr-gurmels-contact"], ["St. Gallen", null, "St. Gallen", "sg-city"],
    ["Spiez", null, "Bern", "be-thun"],
    ["Diepoldsau", null, "St. Gallen", "sg-diepoldsau"], ["Wartau", "Frümsen", "St. Gallen", "sg-werdenberg"],
    ["Appenzell", null, "Appenzell Innerrhoden", "ai-core"], ["Herisau", null, "Appenzell Ausserrhoden", "ar-hinter"],
    ["Frauenfeld", null, "Thurgau", "tg-west"], ["Arbon", null, "Thurgau", "tg-east"], ["Kerns", null, "Obwalden", "ow-sarnen-kerns"],
    ["Stans", null, "Nidwalden", "nw-core"], ["Muotathal", null, "Schwyz", "sz-muotathal"], ["Altdorf", null, "Uri", "ur-reuss"],
    ["Andermatt", null, "Uri", "ur-urseren"], ["Glarus", null, "Glarus", "gl-central"], ["Schaffhausen", null, "Schaffhausen", "sh-city"],
    ["Bosco Gurin", null, "Ticino", "ti-bosco-gurin"], ["Samnaun", null, "Graubünden", "gr-samnaun"], ["Avers", "Juf", "Graubünden", "gr-avers"],
    ["Vals", null, "Graubünden", "gr-vals"], ["Safiental", "Safien", "Graubünden", "gr-safien"],
    ["Obersaxen Mundaun", "Obersaxen", "Graubünden", "gr-obersaxen"], ["Bergün Filisur", "Bergün", "Graubünden", "rm-bergun"],
    ["Sils im Engadin/Segl", "Segl", "Graubünden", "rm-puter"], ["Sils im Domleschg", "Sils im Domleschg", "Graubünden", "gr-rhine-rm-contact"],
    ["Moutier", null, "Jura", "fr-jura"],
  ] as const)("resolves %s / %s to %s", (municipality, locality, canton, expected) => {
    expect(dialectRegionForBench(official(municipality, locality, canton))).toBe(expected);
  });

  test("keeps official geography ahead of stale free text", () => {
    expect(dialectRegionForBench(official("Bern", null, "Bern", { locationName: "Zürich" }))).toBe("be-mittelland");
  });

  test("resolves a Spiez shoreline bench from its exact locality when the lake surface has no municipality polygon", () => {
    expect(resolveDialect(place({
      latitude: 46.6855012,
      longitude: 7.6972335,
      locationName: "Spiez",
      locationCanton: "Bern",
    }), "de", {
      insideSwitzerland: true,
      areaIds: [],
      languageArea: "de",
      sourceVersion: "swissBOUNDARIES3D_2026-01+sprg20220501",
    })).toMatchObject({ areaId: "be-thun", voiceId: "gsw-bern-oberland", matchKind: "free-text" });
  });

  test("selects contact voices using the app language", () => {
    const biel = official("Biel/Bienne", "Biel", "Bern");
    expect(resolveDialect(biel, "de").voiceId).toBe("gsw-bern");
    expect(resolveDialect(biel, "fr").voiceId).toBe("frc-jura");
    const bivio = official("Surses", "Bivio", "Graubünden");
    expect(resolveDialect(bivio, "rm").voiceId).toBe("rm-surmiran");
    expect(resolveDialect(bivio, "it").voiceId).toBe("lmo-prealpine");
  });

  test("does not invent a dialect outside Switzerland", () => {
    expect(resolveDialect(place({ latitude: 48.8566, longitude: 2.3522, locationName: null, locationCanton: null }), "de"))
      .toMatchObject({ areaId: null, voiceId: null, matchKind: "unknown" });
  });

  test("keeps local voices deterministic and distinguishes all light states", () => {
    const shaded = localBenchVoice(place({ sunnyNow: false, shadeCause: "vegetation" }));
    expect(shaded).toMatchObject({ region: "zh-core", regionLabel: "Züridütsch", languageTag: "gsw-CH", uiLanguage: "de" });
    expect(shaded?.second).toContain("Schatte");
    expect(localBenchVoice(place({ dayPhase: "night", shadeCause: "nacht" }))?.second).toContain("Nacht");
    expect(localBenchVoice(place({ sunnyNow: null, shadeCause: "unbekannt" }))?.second).toContain("nöd bekannt");
  });

  test("switches the complete bench information to the local language family", () => {
    expect(localLanguageForBench(official("Lausanne", null, "Vaud"))).toBe("fr");
    expect(localLanguageForBench(official("Lugano", null, "Ticino"))).toBe("it");
    expect(localLanguageForBench(official("Scuol", null, "Graubünden"))).toBe("rm");
  });
});
