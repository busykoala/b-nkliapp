import type { BenchDetail } from "@/lib/types";

/** Synthetic appendix fixture, independent of live weather and shared test databases. */
export function sourceBench(changes: Partial<BenchDetail> = {}): BenchDetail {
  return {
    id: "source-fixture", osmType: "node", osmId: 101,
    latitude: 47.3767, longitude: 8.5418, title: "Lindenhof", name: "Lindenhof",
    dedication: null, description: null, locationName: "Zürich", locationPostcode: "8001", locationCanton: "ZH",
    operatorName: null, verificationStatus: "verified", confirmationCount: 3,
    lastConfirmedAt: "2026-09-20T12:00:00Z", myLastConfirmedAt: null, verificationThreshold: 3, removalConfirmationCount: 0,
    properties: [
      { key: "backrest", label: "Rückenlehne", value: "Ja", canonicalValue: true, evidenceState: "known", source: "OpenStreetMap" },
      { key: "covered", label: "Überdachung", value: "Nein", canonicalValue: false, evidenceState: "known", source: "OpenStreetMap" },
      { key: "material", label: "Material", value: "Holz", canonicalValue: "wood", evidenceState: "known", source: "Bänkli App" },
    ],
    knowledge: {
      attributes: [
        { attribute: "backrest", value: true, confidence: "high", conflicting: false, evidenceCount: 2, sourceTypes: ["osm", "community"], latestAt: "2026-09-20", freshness: "recent" },
        { attribute: "covered", value: false, confidence: "medium", conflicting: false, evidenceCount: 1, sourceTypes: ["osm"], latestAt: "2026-09-10", freshness: "recent" },
      ],
      geography: { municipalityName: "Zürich", municipalityId: "261", cantonName: "Zürich", districtName: "Zürich", localityName: "Lindenhof", confidence: "high", sourceVersion: "fixture-geography-2026" },
      amenities: [
        { category: "toilets", distanceMeters: 120, sourceId: "fixture-wc", latitude: 47.377, longitude: 8.542, count100m: 0, count250m: 1, count500m: 1 },
        { category: "fountain", distanceMeters: 40, sourceId: "fixture-water", latitude: 47.377, longitude: 8.541, count100m: 1, count250m: 1, count500m: 1 },
      ],
      approach: { lengthMeters: 180, maximumSlopePercent: 7.5, averageSlopePercent: 3.2, elevationGainMeters: 9, steps: false, surface: "asphalt", smoothness: "good", widthMeters: 1.5, stepFreePossible: null, confidence: "medium", unmappedLastMeters: 6, sampleCoverage: { expected: 12, sampled: 10 }, computedAt: "2026-09-10" },
      photoEstimates: [{ attribute: "material", value: "wood", imageHashes: ["fixture-photo"], modelVersion: "fixture-image-model", promptVersion: "test-1", capturedAt: "2026-08-25", assessedAt: "2026-09-10", validationSamples: 12 }],
      noise: [
        { mode: "road", period: "day", value: 51, unit: "dB(A)", datasetVersion: "fixture-noise-" + "a".repeat(96) },
        { mode: "road", period: "night", value: 43, unit: "dB(A)", datasetVersion: "fixture-noise-" + "a".repeat(96) },
        { mode: "rail", period: "day", value: null, unit: "dB(A)", datasetVersion: "fixture-rail-2026" },
      ],
      completeness: [
        { category: "physical", known: 4, total: 7, uncertain: 1, missing: ["armrest", "seats"] },
        { category: "accessibility", known: 3, total: 4, uncertain: 1, missing: [] },
      ],
      question: null,
    },
    covered: false, elevationMeters: 408, elevationSource: "fixture", analysisCoverage: "terrain",
    viewScore: 4, viewComponents: { openness: .93, relief: .7, water: .2, naturalness: .5, remoteness: .4 },
    nearOpenness: .72, viewConfidence: "mittel", viewExplanation: ["openness", "model"], photoEvidence: null,
    sunrise: "07:15", sunset: "19:10", directSunrise: "08:30", directSunset: "17:00",
    sunMinutesToday: 270, shadeMinutesToday: 445, daylightMinutesToday: 715,
    sunWindows: [{ start: "08:30", end: "11:00" }, { start: "15:00", end: "17:00" }],
    shadeWindows: [{ start: "07:15", end: "08:30" }, { start: "11:00", end: "15:00" }, { start: "17:00", end: "19:10" }],
    shadeCause: "gelände", sunnyNow: false, sunConfidence: "mittel", sunAltitudeDegrees: 40.4, sunAzimuthDegrees: 175,
    daylightProgress: .5, localMinutesNow: 720, skyObservedAt: "2026-09-20T10:00:00Z", dayPhase: "day", season: "autumn",
    moonAltitudeDegrees: -10, moonAzimuthDegrees: 250, moonIllumination: .6, moonPhase: .3, moonVisible: false,
    moonrise: "21:00", moonset: "09:00", skyTrack: { sun: [], moon: [] },
    weather: {
      temperatureC: 18, precipitationMm10: 0, precipitationRateMmH: 0, precipitationType: "none",
      sunshineMinutes10: null, windKmh: 9, humidityPercent: 65, globalRadiationWm2: null,
      cloudCover: .4, cloudLow: null, cloudMid: null, cloudHigh: null, snowCoverPercent: null,
      snowDepthCm: 0, snowfallLimitMeters: null, location: "Zürich", observedAt: "2026-09-20T10:00:00Z", source: "MeteoSchweiz",
    },
    sunMinutesSpring: 270, sunMinutesSummer: 480, sunMinutesAutumn: 270, sunMinutesWinter: 90,
    inForest: false, landContext: "urban", waterfront: false, canopyContext: "partial", canopyPercent: 20,
    canopyShare3m: 0, canopyShare10m: .1, canopyShare25m: .2, vegetationMedianHeight: 6, vegetationMaxHeight: 17,
    distanceWaterMeters: 140, distancePathMeters: 0, directionDegrees: 205, panoramaStatus: "unavailable",
    buildingObstructionPercent: 12, vegetationObstructionPercent: 20, distanceBuildingMeters: 48, buildingCount100m: 7,
    viewLabels: ["Bergblick"], likelyEnvironment: null,
    ratingAverage: null, ratingCount: 0, ratingBreakdown: null, myRating: null, recentRatings: [], corrections: [],
    observations: { light: { mine: null, publicTrend: null }, view: { mine: null, publicEstimate: { contributors: 3, confidence: .6, components: { openness: .8, sky: .93, relief: .7, water: null, naturalness: .5, remoteness: .4 }, horizon: { open: .68, trees: .2, buildings: .12 } } } },
    media: [], moments: [], care: { counts: {}, mine: [] }, followingBench: false, followingPlace: false,
    directionContributedByMe: false, sourceUpdatedAt: "2026-09-10", importedAt: "2026-09-11", osmVersion: 3, osmChangeset: null, pipelineVersion: "fixture-pipeline-1",
    ...changes,
  };
}
