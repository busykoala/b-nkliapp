import "server-only";
import { readBenchKnowledge } from "@/features/bench-knowledge/repository";

import { sqlite } from "@/db/client";
import { displayMaterial, yesNoUnknown } from "@/lib/bench";
import { calculateSunState, getDaylightState, getLocalSunSchedule, getMoonState, getSkyTrack, getSunTimes, type ObstructionType } from "@/lib/sun";
import type { BenchDetail, BenchProperty, LikelyEnvironment } from "@/lib/types";
import { visionLabelsEnabled } from "@/lib/vision-gate";
import { getLocalWeather } from "@/integrations/weather/service";
import { nearestMappedWayDistance } from "@/lib/walking-provider";
import type { CurrentUser } from "@/lib/security";
import { readBenchObservationSummary } from "@/features/bench-observations/repository";
import { directionalOpenness, scoreViewComponents } from "@/features/bench-observations/model";
import { benchObservationNow } from "@/features/bench-observations/context";
import { readBenchCommunity, readContributedFields, readDetailMetadata, readDetailRow, readEvidenceCoverage, readLatestVisionStats, readPhotoEvidence } from "./repository";

function aiLabelsEnabled() {
  return visionLabelsEnabled(process.env.BENCHLY_AI_LABELS_ENABLED, readLatestVisionStats());
}

function parseArray<T>(value: unknown): T[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function zurichMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function zurichSeason(date: Date): BenchDetail["season"] {
  const month = Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Zurich", month: "numeric" }).format(date));
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

export function readBenchPageMetadata(benchId: string) {
  if (!/^(osm-(node|way)-\d+|community-[0-9a-f-]{36}|inventory-[0-9a-f]{24})$/.test(benchId)) return null;
  const row = readDetailMetadata(benchId);
  if (!row) return null;
  const viewScore = row.view_score === null ? null : Math.max(1, Math.min(5, Math.round(row.view_score / 20)));
  return { title: row.title, viewScore };
}

export function readBenchDetail(benchId: string, currentUser: CurrentUser | null): BenchDetail | null {
  if (!/^(osm-(node|way)-\d+|community-[0-9a-f-]{36}|inventory-[0-9a-f]{24})$/.test(benchId)) return null;
  const row = readDetailRow(benchId);
  if (!row) return null;

  const knowledge = readBenchKnowledge(Number(row.row_id), currentUser?.id);
  const { all: contributedFields, mine: myContributedFields, latestEdits, lastConfirmedAt: myLastConfirmedAt } = readContributedFields(Number(row.row_id), currentUser?.id ?? null);
  // A direct edit remains immediately visible while the bounded worker resolves new evidence.
  const resolved = (field: string) => knowledge.attributes.find((item) => item.attribute === field
    && (!latestEdits[field] || Date.parse(item.resolvedAt ?? "") >= Date.parse(latestEdits[field]))
    && (row.osm_timestamp == null || Date.parse(item.resolvedAt ?? "") >= Date.parse(String(row.imported_at))));
  const roof = resolved("covered");
  const covered = roof ? roof.value : row.covered;
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  const directionDegrees = row.effective_direction_degrees === null ? null : Number(row.effective_direction_degrees);
  const elevationMeters = row.elevation_meters == null ? null : Number(row.elevation_meters);
  const elevationSource = row.elevation_source == null ? null : String(row.elevation_source);
  const pipelineVersion = row.pipeline_version ? String(row.pipeline_version) : "OSM-Nahbereich v1";
  const horizon = parseArray<number>(row.horizon_profile);
  const obstructionTypes = parseArray<ObstructionType>(row.obstruction_types);
  const sunMinutesSummer = row.sun_minutes_summer == null ? null : Number(row.sun_minutes_summer);
  const sunMinutesWinter = row.sun_minutes_winter == null ? null : Number(row.sun_minutes_winter);
  const sunMinutesSpring = row.sun_minutes_spring == null ? null : Number(row.sun_minutes_spring);
  const sunMinutesAutumn = row.sun_minutes_autumn == null ? null : Number(row.sun_minutes_autumn);
  let components: Record<string, number> = {};
  try { components = row.view_components ? JSON.parse(String(row.view_components)) : {}; } catch { components = {}; }
  const hasTerrainModel = parseArray<number>(row.terrain_horizon_profile).length === 72;
  const { exactLand: exactLandEvidence, exactOsm: exactOsmEvidence } = readEvidenceCoverage();
  // “Nicht im Wald” is only a fact once a complete polygon source has been
  // imported. Missing polygons in the legacy seed mean unknown, not false.
  const inForest = !exactLandEvidence || row.in_forest === null ? null : Boolean(row.in_forest);
  const landContext = row.land_context === null ? null : String(row.land_context) as BenchDetail["landContext"];
  const waterfront = !exactLandEvidence || row.waterfront === null ? null : Boolean(row.waterfront);
  const canopyContext = row.canopy_context === null ? null : String(row.canopy_context) as BenchDetail["canopyContext"];
  const canopyPercent = row.canopy_percent === null ? null : Number(row.canopy_percent);
  const canopyShare3m = row.canopy_share_3m === null ? null : Number(row.canopy_share_3m);
  const canopyShare10m = row.canopy_share_10m === null ? null : Number(row.canopy_share_10m);
  const canopyShare25m = row.canopy_share_25m === null ? null : Number(row.canopy_share_25m);
  const vegetationMedianHeight = row.vegetation_median_height === null ? null : Number(row.vegetation_median_height);
  const vegetationMaxHeight = row.vegetation_max_height === null ? null : Number(row.vegetation_max_height);
  const distanceWaterMeters = !exactLandEvidence || row.distance_water_meters === null ? null : Number(row.distance_water_meters);
  const mappedWayDistances = [row.distance_path_meters, row.distance_major_road_meters]
    .flatMap((value) => value === null || value === undefined ? [] : [Number(value)]);
  const distancePathMeters = !exactOsmEvidence || !mappedWayDistances.length ? null : Math.min(...mappedWayDistances);
  const sunInput = { latitude, longitude, horizonProfile: horizon, obstructionTypes, covered: Boolean(covered), canopyPercent };
  const now = benchObservationNow();
  const season = zurichSeason(now);
  const sun = calculateSunState({ ...sunInput, date: now });
  const daylight = getDaylightState(now, latitude, longitude);
  const moon = getMoonState(now, latitude, longitude);
  const weather = getLocalWeather(latitude, longitude, elevationMeters);
  const community = readBenchCommunity(row, currentUser?.id ?? null);
  const skyTrack = getSkyTrack(now, latitude, longitude);
  const localSun = getLocalSunSchedule(sunInput);
  const times = getSunTimes(now, latitude, longitude);
  const observationMinutes = zurichMinutes(now);
  const observationDayPhase = observationMinutes < 600 ? "morning" : observationMinutes < 1020 ? "day" : "evening";
  const observations = readBenchObservationSummary(sqlite, Number(row.row_id), currentUser?.id ?? null, season, observationDayPhase);
  const communityComponents = observations.view.publicEstimate?.components;
  const displayedComponents = {
    openness: communityComponents?.sky ?? components.openness ?? null,
    relief: communityComponents?.relief ?? components.relief ?? null,
    water: communityComponents?.water ?? components.water ?? null,
    naturalness: communityComponents?.naturalness ?? components.naturalness ?? null,
    remoteness: communityComponents?.remoteness ?? components.remoteness ?? null,
  };
  const objectiveNearOpenness = directionalOpenness(obstructionTypes, directionDegrees);
  const displayedNearOpenness = communityComponents?.openness ?? objectiveNearOpenness;
  const ratingCount = Number(row.rating_count ?? 0);
  // A near-field-only model cannot honestly produce the full 1–5 view score:
  // relief is 25% of that model and the distant horizon is still unknown.
  const communityViewScore = observations.view.publicEstimate ? scoreViewComponents({
    sky: displayedComponents.openness,
    relief: displayedComponents.relief,
    water: displayedComponents.water,
    naturalness: displayedComponents.naturalness,
    remoteness: displayedComponents.remoteness,
  }) : null;
  const rawViewScore = communityViewScore ?? (hasTerrainModel && row.view_score !== null ? Number(row.view_score) : null);
  const viewScore = rawViewScore === null ? null : Math.max(1, Math.min(5, Math.round(rawViewScore / 20)));
  const explanation: BenchDetail["viewExplanation"] = [];
  const viewLabels = parseArray<string>(row.view_labels);
  if ((components.openness ?? 0) > 0.8) explanation.push("openness");
  if ((components.relief ?? 0) > 0.8) explanation.push("relief");
  if ((components.water ?? 0) > 0.75) explanation.push("water");
  if ((components.naturalness ?? 0) > 0.8) explanation.push("naturalness");
  if (observations.view.publicEstimate) explanation.push("community");
  if (explanation.length === 0) explanation.push("model");

  const likelyConfidence = String(row.likely_confidence ?? "low") as "high" | "medium" | "low";
  const likelyEvidenceCount = Number(row.likely_evidence_group_count ?? 0);
  const likelyUpdatedAt = String(row.likely_updated_at ?? "");
  const likelyEvidence = parseArray<LikelyEnvironment["evidence"][number]>(row.likely_evidence_summary);
  const directViewEvidenceCount = likelyEvidence.filter((item) => item.directView).length;
  const likelyEnvironment = aiLabelsEnabled() && row.likely_confidence ? {
    confidence: likelyConfidence,
    evidenceGroupCount: likelyEvidenceCount,
    updatedAt: likelyUpdatedAt,
    modelVersion: row.likely_model_version ? String(row.likely_model_version) : null,
    traits: [
      row.likely_land_context && row.likely_land_probability !== null ? { kind: "land" as const, value: String(row.likely_land_context), probability: Number(row.likely_land_probability) } : null,
      row.likely_canopy_context && row.likely_canopy_probability !== null ? { kind: "canopy" as const, value: String(row.likely_canopy_context), probability: Number(row.likely_canopy_probability) } : null,
      likelyTrait("lake", row.likely_lake_view_probability),
      likelyTrait("mountain", row.likely_mountain_view_probability),
      likelyTrait("open", row.likely_open_view_probability),
      likelyTrait("limited", row.likely_limited_view_probability),
      likelyTrait("buildings", row.likely_buildings_probability),
      likelyTrait("roadRail", row.likely_road_rail_probability),
    ].filter((trait): trait is NonNullable<typeof trait> => trait !== null && trait.probability >= .5)
      .map((trait) => {
        const isView = ["lake", "mountain", "open", "limited"].includes(trait.kind);
        const evidenceCount = isView ? directViewEvidenceCount : likelyEvidenceCount;
        return { ...trait, confidence: traitConfidence(trait.probability, evidenceCount), evidenceCount, updatedAt: likelyUpdatedAt };
      }),
    evidence: likelyEvidence,
  } : null;

  const propertySource = (field: string): BenchProperty["source"] => contributedFields.has(field) || row.osm_type === "community" ? "Bänkli App" : String(row.id).startsWith("inventory-") ? "Amtliche Daten" : "OpenStreetMap";
  const properties: BenchProperty[] = [
    { key: "backrest" as const, label: "Rückenlehne", value: yesNoUnknown(row.backrest as number | null), source: propertySource("backrest"), contributedByMe: myContributedFields.has("backrest") },
    { key: "armrest" as const, label: "Armlehnen", value: yesNoUnknown(row.armrest as number | null), source: propertySource("armrest"), contributedByMe: myContributedFields.has("armrest") },
    { key: "covered" as const, label: "Überdacht", value: yesNoUnknown(row.covered as number | null), source: propertySource("covered"), contributedByMe: myContributedFields.has("covered") },
    { key: "wheelchair" as const, label: "Mit Rollstuhl nutzbar", value: yesNoUnknown(row.wheelchair as number | null), source: propertySource("wheelchair"), contributedByMe: myContributedFields.has("wheelchair") },
    { key: "fireplaceNearby" as const, label: "Feuerstelle nahebei", value: yesNoUnknown(row.fireplace_nearby as number | null), source: propertySource("fireplaceNearby"), contributedByMe: myContributedFields.has("fireplaceNearby") },
    { key: "wasteBasketNearby" as const, label: "Abfalleimer nahebei", value: yesNoUnknown(row.waste_basket_nearby as number | null), source: propertySource("wasteBasketNearby"), contributedByMe: myContributedFields.has("wasteBasketNearby") },
    { key: "material" as const, label: "Material", value: displayMaterial(row.material as string | null), source: propertySource("material"), contributedByMe: myContributedFields.has("material") },
    { key: "seats" as const, label: "Sitzplätze", value: row.seats ? String(row.seats) : "Unbekannt", source: propertySource("seats"), contributedByMe: myContributedFields.has("seats") },
  ].map((property) => {
    const state = resolved(property.key);
    if (!state) return property;
    const value = state.value == null ? "Unbekannt"
      : property.key === "material" ? displayMaterial(String(state.value))
      : property.key === "seats" ? String(state.value)
      : yesNoUnknown(Number(state.value));
    const source: BenchProperty["source"] = state.sourceTypes.length > 1 ? "Mehrere Quellen"
      : state.sourceTypes[0] === "community" ? "Bänkli App" : state.sourceTypes[0] === "official" ? "Amtliche Daten" : "OpenStreetMap";
    return { ...property, value, source };
  });
  return {
    id: String(row.id), osmType: String(row.osm_type), osmId: Number(row.osm_id),
    latitude, longitude, title: String(row.name || (row.description === "Sitzbank" ? "" : row.description) || ""),
    name: row.name === null ? null : String(row.name),
    dedication: row.dedication === null ? null : String(row.dedication),
    locationName: knowledge.geography?.localityName ?? knowledge.geography?.municipalityName ?? (row.location_name == null ? null : String(row.location_name)),
    locationPostcode: row.location_postcode === null ? null : String(row.location_postcode),
    locationCanton: knowledge.geography?.cantonName ?? (row.location_canton == null ? null : String(row.location_canton)),
    verificationStatus: String(row.verification_status) === "unverified" ? "unverified" : "verified",
    confirmationCount: Number(row.confirmation_count ?? 0),
    lastConfirmedAt: row.last_confirmed_at == null ? null : String(row.last_confirmed_at),
    myLastConfirmedAt,
    verificationThreshold: Math.max(2, Math.min(10, Number(process.env.BENCH_VERIFICATION_THRESHOLD ?? 3) || 3)),
    removalConfirmationCount: Number(row.removal_confirmation_count ?? 0),
    description: null, operatorName: row.operator ? String(row.operator) : null, properties,
    elevationMeters,
    elevationSource,
    analysisCoverage: hasTerrainModel ? "terrain" : "near-field",
    viewScore,
    viewComponents: displayedComponents,
    photoEvidence: readPhotoEvidence(row),
    nearOpenness: displayedNearOpenness,
    viewConfidence: (hasTerrainModel
      ? pipelineVersion === "GeoAdmin-Horizont v6" && !exactOsmEvidence ? "niedrig" : row.view_confidence ?? "mittel"
      : "niedrig") as BenchDetail["viewConfidence"], viewExplanation: explanation,
    sunrise: times.sunrise, sunset: times.sunset,
    directSunrise: localSun.directSunrise, directSunset: localSun.directSunset,
    sunMinutesToday: localSun.sunMinutes, shadeMinutesToday: localSun.shadeMinutes,
    daylightMinutesToday: localSun.daylightMinutes, sunWindows: localSun.windows, shadeWindows: localSun.shadeWindows,
    shadeCause: sun?.shadeCause ?? "unbekannt",
    sunnyNow: sun?.sunny ?? null,
    sunConfidence: (hasTerrainModel
      ? pipelineVersion === "GeoAdmin-Horizont v6" && !exactOsmEvidence ? "niedrig" : row.sun_confidence ?? "mittel"
      : "niedrig") as BenchDetail["sunConfidence"],
    sunAltitudeDegrees: daylight.altitude,
    sunAzimuthDegrees: daylight.azimuth,
    daylightProgress: daylight.progress,
    localMinutesNow: zurichMinutes(now),
    dayPhase: daylight.phase,
    season,
    moonAltitudeDegrees: moon.altitude,
    moonAzimuthDegrees: moon.azimuth,
    moonIllumination: moon.fraction,
    moonPhase: moon.phase,
    moonVisible: moon.visible,
    moonrise: moon.rise,
    moonset: moon.set,
    skyTrack,
    weather,
    sunMinutesSummer,
    sunMinutesWinter,
    sunMinutesSpring,
    sunMinutesAutumn,
    inForest, landContext, waterfront, canopyContext, canopyPercent,
    canopyShare3m, canopyShare10m, canopyShare25m, vegetationMedianHeight, vegetationMaxHeight,
    distanceWaterMeters, distancePathMeters,
    directionDegrees,
    panoramaStatus: String(row.panorama_status ?? "unavailable") as BenchDetail["panoramaStatus"],
    buildingObstructionPercent: row.building_obstruction_percent === null ? null : Number(row.building_obstruction_percent),
    vegetationObstructionPercent: row.vegetation_obstruction_percent === null ? null : Number(row.vegetation_obstruction_percent),
    distanceBuildingMeters: row.distance_building_meters === null ? null : Number(row.distance_building_meters),
    buildingCount100m: row.building_count_100m === null ? null : Number(row.building_count_100m),
    viewLabels, likelyEnvironment,
    ratingAverage: row.rating_average === null ? null : Number(Number(row.rating_average).toFixed(1)), ratingCount,
    ratingBreakdown: ratingCount ? { overall: Number(Number(row.rating_average).toFixed(1)), view: Number(Number(row.rating_view).toFixed(1)), comfort: Number(Number(row.rating_comfort).toFixed(1)), quiet: Number(Number(row.rating_quiet).toFixed(1)) } : null,
    myRating: community.myRating,
    recentRatings: community.recentRatings, corrections: community.corrections, observations, media: community.media,
    moments: community.moments, care: { counts: community.careCounts, mine: community.myCare },
    followingBench: community.followingBench, followingPlace: community.followingPlace,
    directionContributedByMe: myContributedFields.has("direction"),
    knowledge,
    sourceUpdatedAt: !String(row.id).startsWith("osm-") ? (row.source_updated_at ? String(row.source_updated_at) : null) : row.osm_timestamp ? String(row.osm_timestamp) : null,
    importedAt: String(row.imported_at), osmVersion: row.osm_version == null ? null : Number(row.osm_version),
    osmChangeset: row.osm_changeset == null ? null : Number(row.osm_changeset), pipelineVersion,
  };
}

export async function readVerifiedBenchDetail(benchId: string, currentUser: CurrentUser | null): Promise<BenchDetail | null> {
  const bench = readBenchDetail(benchId, currentUser);
  if (!bench) return null;
  try {
    const distancePathMeters = await nearestMappedWayDistance(
      { label: bench.title || bench.id, latitude: bench.latitude, longitude: bench.longitude },
      AbortSignal.timeout(1_500),
    );
    return { ...bench, distancePathMeters };
  } catch {
    return { ...bench, distancePathMeters: null };
  }
}

function likelyTrait(kind: "lake" | "mountain" | "open" | "limited" | "buildings" | "roadRail", value: string | number | null) {
  return value === null ? null : { kind, value: kind, probability: Number(value) };
}

function traitConfidence(probability: number, evidenceCount: number): "high" | "medium" | "low" {
  if (probability >= .85 && evidenceCount >= 2) return "high";
  if (probability >= .65 && evidenceCount >= 1) return "medium";
  return "low";
}
