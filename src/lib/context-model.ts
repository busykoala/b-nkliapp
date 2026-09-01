import type { ObstructionType } from "./sun";

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
  viewScore: number;
  viewLabels: string[];
  viewExplanation: string[];
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

export function buildContextModel(latitude: number, longitude: number, directionDegrees: number | null, features: ContextFeature[]): ContextModel {
  const horizonProfile = Array<number>(72).fill(0);
  const obstructionTypes = Array<ObstructionType>(72).fill("unknown");
  const buildings = features.filter((feature) => feature.kind === "building");
  const trees = features.filter((feature) => feature.kind === "tree");
  const forests = features.filter((feature) => feature.kind === "forest");
  const waters = features.filter((feature) => feature.kind === "water");
  const paths = features.filter((feature) => feature.kind === "path");
  const roads = features.filter((feature) => feature.kind === "major_road");

  for (const feature of [...buildings, ...trees]) {
    const distance = Math.max(2.5, featureDistance(latitude, longitude, feature));
    if (distance > 350) continue;
    const height = feature.height_meters ?? (feature.kind === "building" ? 8.5 : 12);
    const angle = Math.max(0, Math.min(89, Math.atan2(Math.max(1, height - 1.1), distance) * 180 / Math.PI));
    const bearing = bearingDegrees(latitude, longitude, feature.center_latitude, feature.center_longitude);
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
  const distanceForestMeters = nearest(forests, latitude, longitude);
  const distanceRoadMeters = nearest(roads, latitude, longitude);
  const inForest = distanceForestMeters !== null && distanceForestMeters <= 15;
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
  const openness = selectedHorizon.filter((angle) => angle < 5).length / Math.max(1, selectedHorizon.length);
  const vegetationObstructionPercent = obstructionTypes.filter((value) => value === "vegetation").length / 72 * 100;
  const buildingObstructionPercent = obstructionTypes.filter((value) => value === "building").length / 72 * 100;
  const canopyPercent = Math.min(95, (inForest ? 55 : 0) + vegetationObstructionPercent * 0.8);
  const water = distanceWaterMeters === null ? 0 : distanceWaterMeters < 300 ? 0.65 : distanceWaterMeters < 1500 ? 0.35 : 0.1;
  const naturalness = Math.min(1, 0.25 + (inForest ? 0.45 : 0) + (distanceWaterMeters !== null && distanceWaterMeters < 500 ? 0.2 : 0));
  const remoteness = Math.min(1, 0.4 * Math.min(1, (distanceBuildingMeters ?? 150) / 100) + 0.6 * Math.min(1, (distanceRoadMeters ?? 400) / 300));
  const viewScore = Math.round(100 * (0.35 * openness + 0.15 * water + 0.15 * naturalness + 0.1 * remoteness));
  const viewLabels: string[] = [];
  if (distanceWaterMeters !== null && distanceWaterMeters < 300) viewLabels.push("Wasser in der Nähe");
  if (inForest) viewLabels.push("Waldumgebung");
  if (openness >= 0.72) viewLabels.push("Freier Nahhorizont");
  if (openness < 0.35) viewLabels.push("Sicht im Nahbereich begrenzt");
  if (!viewLabels.length) viewLabels.push("Teilweise freie Sicht");
  const viewExplanation = [
    `${Math.round(openness * 100)}% des Nahhorizonts sind frei von erfassten Gebäuden und Einzelbäumen.`,
    "Bergrelief und Fernsicht werden ergänzt, sobald das swisstopo-Geländemodell für diese Bank verarbeitet ist.",
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
    viewScore,
    viewLabels,
    viewExplanation,
  };
}
