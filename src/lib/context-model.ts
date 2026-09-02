import type { ObstructionType } from "./sun";
import { HORIZON_DISTANCES_METERS } from "./elevation";

export type ContextFeature = {
  kind: "building" | "tree" | "water" | "forest" | "path" | "major_road";
  center_latitude: number;
  center_longitude: number;
  min_latitude: number;
  max_latitude: number;
  min_longitude: number;
  max_longitude: number;
  height_meters: number | null;
  subtype: string | null;
  /** Set only by an exact projected-geometry test; bounding-box proximity is insufficient. */
  containsBench?: boolean;
};

export type ContextModel = {
  horizonProfile: number[];
  obstructionTypes: ObstructionType[];
  buildingObstructionPercent: number;
  vegetationObstructionPercent: number;
  canopyPercent: number;
  inForest: boolean;
  distanceWaterMeters: number | null;
  distancePathMeters: number | null;
  distanceBuildingMeters: number | null;
  buildingCount100m: number;
  buildingCount350m: number;
  treeCount350m: number;
  nearOpennessPercent: number;
  viewScore: number;
  viewComponents: { openness: number; relief: number; water: number; naturalness: number; remoteness: number };
  viewLabels: string[];
  viewExplanation: string[];
};

export type TerrainEvidence = {
  elevationMeters: number;
  horizonProfile: number[];
  sampleElevations: number[];
};

function distanceMeters(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const meanLatitude = ((latitudeA + latitudeB) / 2) * Math.PI / 180;
  const north = (latitudeB - latitudeA) * 111_320;
  const east = (longitudeB - longitudeA) * 111_320 * Math.cos(meanLatitude);
  return Math.hypot(north, east);
}

function featureDistance(latitude: number, longitude: number, feature: ContextFeature) {
  const nearestLatitude = Math.min(Math.max(latitude, feature.min_latitude), feature.max_latitude);
  const nearestLongitude = Math.min(Math.max(longitude, feature.min_longitude), feature.max_longitude);
  return distanceMeters(latitude, longitude, nearestLatitude, nearestLongitude);
}

function bearingDegrees(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const north = (latitudeB - latitudeA) * 111_320;
  const east = (longitudeB - longitudeA) * 111_320 * Math.cos(((latitudeA + latitudeB) / 2) * Math.PI / 180);
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

function circularDifference(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function nearest(features: ContextFeature[], latitude: number, longitude: number) {
  if (!features.length) return null;
  return Math.min(...features.map((feature) => featureDistance(latitude, longitude, feature)));
}

function terrainBaseAt(terrain: TerrainEvidence | undefined, bearing: number, distance: number) {
  if (!terrain || terrain.sampleElevations.length !== 72 * HORIZON_DISTANCES_METERS.length) return terrain?.elevationMeters ?? 0;
  const bearingIndex = Math.round(bearing / 5) % 72;
  let distanceIndex = 0;
  let smallestDifference = Infinity;
  for (let index = 0; index < HORIZON_DISTANCES_METERS.length; index += 1) {
    const difference = Math.abs(HORIZON_DISTANCES_METERS[index] - distance);
    if (difference < smallestDifference) {
      smallestDifference = difference;
      distanceIndex = index;
    }
  }
  return terrain.sampleElevations[bearingIndex * HORIZON_DISTANCES_METERS.length + distanceIndex];
}

export function buildContextModel(latitude: number, longitude: number, directionDegrees: number | null, features: ContextFeature[], terrain?: TerrainEvidence): ContextModel {
  const hasTerrain = terrain?.horizonProfile.length === 72;
  const horizonProfile = hasTerrain ? [...terrain.horizonProfile] : Array<number>(72).fill(0);
  const obstructionTypes = Array<ObstructionType>(72).fill(hasTerrain ? "terrain" : "unknown");
  const buildings = features.filter((feature) => feature.kind === "building");
  const trees = features.filter((feature) => feature.kind === "tree");
  const forests = features.filter((feature) => feature.kind === "forest");
  const waters = features.filter((feature) => feature.kind === "water");
  const paths = features.filter((feature) => feature.kind === "path");
  const roads = features.filter((feature) => feature.kind === "major_road");
  const nearBuildings = buildings.filter((feature) => featureDistance(latitude, longitude, feature) <= 350);
  const nearTrees = trees.filter((feature) => featureDistance(latitude, longitude, feature) <= 350);

  for (const feature of [...buildings, ...trees]) {
    const distance = Math.max(2.5, featureDistance(latitude, longitude, feature));
    if (distance > 350) continue;
    const bearing = bearingDegrees(latitude, longitude, feature.center_latitude, feature.center_longitude);
    const height = feature.height_meters ?? (feature.kind === "building" ? 8.5 : 12);
    const baseHeight = terrainBaseAt(terrain, bearing, distance);
    const relativeTop = hasTerrain ? baseHeight + height - (terrain.elevationMeters + 1.1) : height - 1.1;
    const angle = Math.max(0, Math.min(89, Math.atan2(Math.max(1, relativeTop), distance) * 180 / Math.PI));
    const width = Math.max(
      4,
      distanceMeters(feature.min_latitude, feature.min_longitude, feature.max_latitude, feature.max_longitude),
    );
    const halfAngle = Math.min(60, Math.max(3, Math.atan2(width / 2, distance) * 180 / Math.PI));
    for (let index = 0; index < 72; index += 1) {
      if (circularDifference(index * 5, bearing) <= halfAngle && angle > horizonProfile[index]) {
        horizonProfile[index] = Number(angle.toFixed(2));
        obstructionTypes[index] = feature.kind === "building" ? "building" : "vegetation";
      }
    }
  }

  const distanceWaterMeters = nearest(waters, latitude, longitude);
  const distanceBuildingMeters = nearest(buildings, latitude, longitude);
  const distancePathMeters = nearest(paths, latitude, longitude);
  const distanceRoadMeters = nearest(roads, latitude, longitude);
  const inForest = forests.some((feature) => feature.containsBench === true);
  if (inForest) {
    for (let index = 0; index < 72; index += 1) {
      if (horizonProfile[index] < 8) {
        horizonProfile[index] = 8;
        obstructionTypes[index] = "vegetation";
      }
    }
  }

  const viewIndices = directionDegrees === null
    ? [...horizonProfile.keys()]
    : [...horizonProfile.keys()].filter((index) => circularDifference(index * 5, directionDegrees) <= 45);
  const selectedHorizon = viewIndices.map((index) => horizonProfile[index]);
  // A mountain at 8° is still a valuable open view. A binary “below 5°” test
  // systematically underrated Alpine valleys, so openness is the mean visible
  // sky above the measured horizon instead.
  const openness = selectedHorizon.reduce((sum, angle) => sum + Math.max(0, 1 - Math.max(0, angle) / 35), 0)
    / Math.max(1, selectedHorizon.length);
  const vegetationObstructionPercent = obstructionTypes.filter((value) => value === "vegetation").length / 72 * 100;
  const buildingObstructionPercent = obstructionTypes.filter((value) => value === "building").length / 72 * 100;
  const canopyPercent = Math.min(95, (inForest ? 55 : 0) + vegetationObstructionPercent * 0.8);
  const visibleWater = hasTerrain ? waters.filter((feature) => {
    const distance = featureDistance(latitude, longitude, feature);
    if (distance > 10_000) return false;
    const bearing = bearingDegrees(latitude, longitude, feature.center_latitude, feature.center_longitude);
    if (directionDegrees !== null && circularDifference(bearing, directionDegrees) > 55) return false;
    return horizonProfile[Math.round(bearing / 5) % 72] < 12;
  }) : [];
  const water = hasTerrain
    ? visibleWater.length > 0 && (distanceWaterMeters ?? Infinity) < 1_500 ? 1 : visibleWater.length > 0 ? 0.7 : 0
    : distanceWaterMeters === null ? 0 : distanceWaterMeters < 300 ? 0.65 : distanceWaterMeters < 1_500 ? 0.35 : 0.1;
  const selectedElevations = hasTerrain && terrain.sampleElevations.length === 72 * HORIZON_DISTANCES_METERS.length
    ? viewIndices.flatMap((index) => terrain.sampleElevations.slice(index * HORIZON_DISTANCES_METERS.length, (index + 1) * HORIZON_DISTANCES_METERS.length))
    : terrain?.sampleElevations ?? [];
  const reliefRange = hasTerrain && selectedElevations.length
    ? Math.max(...selectedElevations) - Math.min(...selectedElevations)
    : 0;
  const relief = Math.min(1, reliefRange / 1_500);
  const naturalness = Math.min(1, 0.25 + (inForest ? 0.45 : 0) + (distanceWaterMeters !== null && distanceWaterMeters < 500 ? 0.2 : 0));
  const remoteness = Math.min(1, 0.4 * Math.min(1, (distanceBuildingMeters ?? 150) / 100) + 0.6 * Math.min(1, (distanceRoadMeters ?? 400) / 300));
  const viewComponents = { openness, relief, water, naturalness, remoteness };
  const viewScore = Math.round(100 * (0.35 * openness + 0.25 * relief + 0.15 * water + 0.15 * naturalness + 0.1 * remoteness));
  const viewLabels: string[] = [];
  if (hasTerrain) {
    const selectedTerrainHorizon = viewIndices.map((index) => terrain.horizonProfile[index]);
    const meanHorizon = selectedHorizon.reduce((sum, angle) => sum + angle, 0) / Math.max(1, selectedHorizon.length);
    const selectedBuildingShare = viewIndices.filter((index) => obstructionTypes[index] === "building").length / Math.max(1, viewIndices.length);
    if (relief >= 0.35 && Math.max(...selectedTerrainHorizon) >= 4) viewLabels.push("Bergblick");
    if (visibleWater.length) viewLabels.push(visibleWater.some((feature) => ["lake", "reservoir", "water"].includes(feature.subtype ?? "")) ? "Seeblick" : "Wasserblick");
    if (openness >= 0.75) viewLabels.push("Weitsicht");
    if (inForest && naturalness >= 0.7) viewLabels.push("Waldblick");
    if (openness < 0.4 || meanHorizon > 22 || selectedBuildingShare > 0.5) viewLabels.push("Eingeschränkte Aussicht");
    if (!viewLabels.length) viewLabels.push("Keine besondere Aussicht");
  } else {
    if (distanceWaterMeters !== null && distanceWaterMeters < 1_500) viewLabels.push("Wasser im Umfeld");
    if (inForest) viewLabels.push("Waldumgebung");
    if (openness >= 0.72) viewLabels.push("Nahbereich weitgehend offen");
    else if (openness < 0.35) viewLabels.push("Nahbereich stark begrenzt");
    else viewLabels.push("Nahbereich teilweise offen");
  }
  const viewExplanation = hasTerrain ? [
    `${Math.round(openness * 100)}% mittlere Himmelsoffenheit im ausgewerteten Blicksektor.`,
    `Das Geländeprofil prüft 72 Richtungen mit 7’632 Höhenpunkten bis 20 km; die sichtrelevante Höhenspanne beträgt ${Math.round(reliefRange)} m.`,
    `Im Nahbereich berücksichtigt: ${nearBuildings.length} Gebäude und ${nearTrees.length} ${nearTrees.length === 1 ? "Einzelbaum" : "Einzelbäume"}.`,
  ] : [
    `${Math.round(openness * 100)}% mittlere Himmelsoffenheit im geprüften Nahbereich.`,
    `Bis 350 m erkannt: ${nearBuildings.length} Gebäude und ${nearTrees.length} ${nearTrees.length === 1 ? "Einzelbaum" : "Einzelbäume"}.`,
    "Eine seriöse Gesamtwertung folgt erst mit Berg-, Gelände- und Fernhorizont.",
  ];

  return {
    horizonProfile,
    obstructionTypes,
    buildingObstructionPercent,
    vegetationObstructionPercent,
    canopyPercent,
    inForest,
    distanceWaterMeters,
    distancePathMeters,
    distanceBuildingMeters,
    buildingCount100m: buildings.filter((feature) => featureDistance(latitude, longitude, feature) <= 100).length,
    buildingCount350m: nearBuildings.length,
    treeCount350m: nearTrees.length,
    nearOpennessPercent: Math.round(openness * 100),
    viewScore,
    viewComponents,
    viewLabels,
    viewExplanation,
  };
}
