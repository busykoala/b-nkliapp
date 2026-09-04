import type { ObstructionType } from "./sun";
import { HORIZON_DISTANCES_METERS, wgs84ToLv95 } from "./elevation";
import { geometryContains, nearestGeometryPoint, type ExactGeometry, type ProjectedPoint } from "./exact-geometry";
import type { LandCoverEvidence } from "./land-cover";

export type ContextFeature = {
  kind: "building" | "tree" | "water" | "forest" | "path" | "major_road";
  center_latitude: number;
  center_longitude: number;
  min_latitude: number;
  max_latitude: number;
  min_longitude: number;
  max_longitude: number;
  height_meters: number | null;
  ground_elevation_meters?: number | null;
  roof_elevation_meters?: number | null;
  subtype: string | null;
  source?: string;
  source_version?: string | null;
  exactGeometry?: ExactGeometry;
  /** Set only by an exact projected-geometry test; bounding-box proximity is insufficient. */
  containsBench?: boolean;
};

export type ContextModel = {
  horizonProfile: number[];
  obstructionTypes: ObstructionType[];
  buildingObstructionPercent: number;
  vegetationObstructionPercent: number;
  canopyPercent: number | null;
  inForest: boolean;
  landContext: "forest" | "forest_edge" | "park" | "open" | "urban" | "mixed" | "unknown";
  waterfront: boolean | null;
  canopyContext: "none" | "partial" | "dense" | "unknown";
  distanceForestMeters: number | null;
  distanceWaterMeters: number | null;
  distancePathMeters: number | null;
  distanceBuildingMeters: number | null;
  buildingCount100m: number;
  buildingCount350m: number;
  treeCount350m: number;
  vegetationMedianHeight: number | null;
  vegetationMaxHeight: number | null;
  nearOpennessPercent: number;
  viewScore: number;
  viewComponents: { openness: number; relief: number; water: number; naturalness: number; remoteness: number };
  viewLabels: string[];
  viewExplanation: string[];
  visibleTerrainMaxMeters: number | null;
  viewKind: "mountain" | "hill" | "none";
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
  if (feature.exactGeometry) {
    const origin = wgs84ToLv95(latitude, longitude);
    return nearestGeometryPoint([origin.easting, origin.northing], feature.exactGeometry)?.distance ?? Infinity;
  }
  const nearestLatitude = Math.min(Math.max(latitude, feature.min_latitude), feature.max_latitude);
  const nearestLongitude = Math.min(Math.max(longitude, feature.min_longitude), feature.max_longitude);
  return distanceMeters(latitude, longitude, nearestLatitude, nearestLongitude);
}

function projectedBearing(origin: ProjectedPoint, target: ProjectedPoint) {
  return (Math.atan2(target[0] - origin[0], target[1] - origin[1]) * 180 / Math.PI + 360) % 360;
}

function featureBearing(latitude: number, longitude: number, feature: ContextFeature) {
  if (feature.exactGeometry) {
    const originLv95 = wgs84ToLv95(latitude, longitude);
    const origin: ProjectedPoint = [originLv95.easting, originLv95.northing];
    const nearest = nearestGeometryPoint(origin, feature.exactGeometry)?.nearest;
    if (nearest && (nearest[0] !== origin[0] || nearest[1] !== origin[1])) return projectedBearing(origin, nearest);
  }
  return bearingDegrees(latitude, longitude, feature.center_latitude, feature.center_longitude);
}

function featureAngularHalfWidth(latitude: number, longitude: number, feature: ContextFeature, centerBearing: number, distance: number) {
  if (feature.exactGeometry) {
    const originLv95 = wgs84ToLv95(latitude, longitude);
    const origin: ProjectedPoint = [originLv95.easting, originLv95.northing];
    const bearings = feature.exactGeometry.paths.flatMap((path) => path.map((point) => projectedBearing(origin, point)));
    if (bearings.length) return Math.min(89, Math.max(2.5, ...bearings.map((bearing) => circularDifference(bearing, centerBearing))));
  }
  const width = Math.max(4, distanceMeters(feature.min_latitude, feature.min_longitude, feature.max_latitude, feature.max_longitude));
  return Math.min(60, Math.max(3, Math.atan2(width / 2, distance) * 180 / Math.PI));
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

function longestRun(values: boolean[], circular: boolean) {
  if (!values.length) return 0;
  const source = circular ? [...values, ...values] : values;
  let current = 0;
  let longest = 0;
  for (const value of source) {
    current = value ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return Math.min(values.length, longest);
}

export function buildContextModel(latitude: number, longitude: number, directionDegrees: number | null, features: ContextFeature[], terrain?: TerrainEvidence, landCover?: LandCoverEvidence): ContextModel {
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
    const bearing = featureBearing(latitude, longitude, feature);
    const height = feature.height_meters ?? (feature.kind === "building" ? 8.5 : 12);
    const baseHeight = terrainBaseAt(terrain, bearing, distance);
    const relativeTop = hasTerrain && feature.roof_elevation_meters !== null && feature.roof_elevation_meters !== undefined
      ? feature.roof_elevation_meters - (terrain.elevationMeters + 1.1)
      : hasTerrain ? baseHeight + height - (terrain.elevationMeters + 1.1) : height - 1.1;
    const angle = Math.max(0, Math.min(89, Math.atan2(Math.max(1, relativeTop), distance) * 180 / Math.PI));
    const halfAngle = featureAngularHalfWidth(latitude, longitude, feature, bearing, distance);
    for (let index = 0; index < 72; index += 1) {
      if (circularDifference(index * 5, bearing) <= halfAngle && angle > horizonProfile[index]) {
        horizonProfile[index] = Number(angle.toFixed(2));
        obstructionTypes[index] = feature.kind === "building" ? "building" : "vegetation";
      }
    }
  }

  const distanceWaterMeters = nearest(waters, latitude, longitude);
  const distanceForestMeters = nearest(forests, latitude, longitude);
  const distanceBuildingMeters = nearest(buildings, latitude, longitude);
  const distancePathMeters = nearest(paths, latitude, longitude);
  const distanceRoadMeters = nearest(roads, latitude, longitude);
  const originLv95 = wgs84ToLv95(latitude, longitude);
  const origin: ProjectedPoint = [originLv95.easting, originLv95.northing];
  const centerForest = landCover?.centerClass === "forest" || landCover?.centerClass === "wood" || landCover?.centerClass === "loose_forest";
  const centerPark = landCover?.centerClass === "park" || landCover?.centerClass === "recreation_ground";
  const forestShare = landCover?.forestShare ?? 0;
  const inForest = forests.some((feature) => feature.containsBench === true
    || Boolean(feature.exactGeometry && geometryContains(origin, feature.exactGeometry)))
    || centerForest || forestShare >= .45;
  if (inForest) {
    for (let index = 0; index < 72; index += 1) {
      const sector = Math.round(index * 5 / 30) % 12;
      const forestInDirection = !landCover || forestShare >= .75 || (landCover.forestBySector[sector] ?? 0) >= 1 / 3;
      if (forestInDirection && horizonProfile[index] < 8) {
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
  const nearBlockedShare = viewIndices.filter((index) => obstructionTypes[index] === "building" || obstructionTypes[index] === "vegetation").length
    / Math.max(1, viewIndices.length);
  // Horizon obstruction and overhead canopy are different measurements. Only
  // the raster worker can provide a defensible canopy percentage.
  const canopyPercent = null;
  const treeDistances = nearTrees.map((feature) => featureDistance(latitude, longitude, feature));
  const landContext: ContextModel["landContext"] = inForest ? "forest"
    : forestShare >= .15 || distanceForestMeters !== null && distanceForestMeters <= 25 ? "forest_edge"
      : centerPark ? "park"
        : buildings.filter((feature) => featureDistance(latitude, longitude, feature) <= 100).length >= 3 ? "urban"
          : nearBuildings.length === 0 && nearTrees.length === 0 ? "open" : "mixed";
  const canopyContext: ContextModel["canopyContext"] = inForest ? forestShare >= .7 || !landCover ? "dense" : "partial"
    : treeDistances.some((distance) => distance <= 5) || treeDistances.filter((distance) => distance <= 12).length >= 2 ? "partial"
      : landContext === "open" || landContext === "urban" ? "none" : "unknown";
  const vegetationHeights = nearTrees.flatMap((feature) => feature.height_meters === null ? [] : [feature.height_meters]).sort((a, b) => a - b);
  const vegetationMedianHeight = vegetationHeights.length ? vegetationHeights[Math.floor(vegetationHeights.length / 2)] : null;
  const vegetationMaxHeight = vegetationHeights.length ? vegetationHeights.at(-1) ?? null : null;
  const visibleWater = hasTerrain ? waters.filter((feature) => {
    const distance = featureDistance(latitude, longitude, feature);
    if (distance > 10_000) return false;
    const bearing = featureBearing(latitude, longitude, feature);
    if (directionDegrees !== null && circularDifference(bearing, directionDegrees) > 55) return false;
    const index = Math.round(bearing / 5) % 72;
    return horizonProfile[index] < 12
      && (obstructionTypes[index] === "terrain" || horizonProfile[index] <= terrain.horizonProfile[index] + .5);
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
  const categoricalNaturalness = inForest ? .9
    : landContext === "forest_edge" ? .7
      : landContext === "park" ? .65
        : landContext === "open" ? .55
          : landContext === "urban" ? .2 : .35;
  const sampledNaturalness = landCover
    ? .42 + .5 * landCover.forestShare + .18 * Math.max(0, landCover.naturalShare - landCover.forestShare)
    : 0;
  const naturalness = Math.min(1, Math.max(categoricalNaturalness, sampledNaturalness)
    + (distanceWaterMeters !== null && distanceWaterMeters < 500 ? .1 : 0));
  const remoteness = Math.min(1, 0.4 * Math.min(1, (distanceBuildingMeters ?? 150) / 100) + 0.6 * Math.min(1, (distanceRoadMeters ?? 400) / 300));
  const viewComponents = { openness, relief, water, naturalness, remoteness };
  const viewScore = Math.round(100 * (0.35 * openness + 0.25 * relief + 0.15 * water + 0.15 * naturalness + 0.1 * remoteness));
  const viewLabels: string[] = [];
  let visibleTerrainMaxMeters: number | null = null;
  let viewKind: ContextModel["viewKind"] = "none";
  if (hasTerrain) {
    const meanHorizon = selectedHorizon.reduce((sum, angle) => sum + angle, 0) / Math.max(1, selectedHorizon.length);
    const selectedBlockedShare = viewIndices.filter((index) => obstructionTypes[index] === "building" || obstructionTypes[index] === "vegetation").length / Math.max(1, viewIndices.length);
    const farStart = HORIZON_DISTANCES_METERS.findIndex((distance) => distance >= 2_000);
    const terrainSectors = viewIndices.map((index) => {
      const elevations = terrain.sampleElevations.slice(index * HORIZON_DISTANCES_METERS.length + farStart, (index + 1) * HORIZON_DISTANCES_METERS.length);
      const maximum = elevations.length ? Math.max(...elevations) : terrain.elevationMeters;
      const visible = horizonProfile[index] <= terrain.horizonProfile[index] + .5;
      const localRelief = maximum - terrain.elevationMeters;
      const prominent = terrain.horizonProfile[index] >= 1.5 && localRelief >= 120;
      if (visible && prominent) visibleTerrainMaxMeters = Math.max(visibleTerrainMaxMeters ?? -Infinity, maximum);
      return { mountain: visible && prominent && localRelief >= 500, hill: visible && prominent && localRelief < 500 };
    });
    const minimumRun = directionDegrees === null ? 8 : 4;
    const mountainRun = longestRun(terrainSectors.map((sector) => sector.mountain), directionDegrees === null);
    const hillRun = longestRun(terrainSectors.map((sector) => sector.hill), directionDegrees === null);
    if (selectedBlockedShare < .5 && mountainRun >= minimumRun) {
      viewKind = "mountain";
      viewLabels.push("Bergblick");
    } else if (selectedBlockedShare < .5 && hillRun >= minimumRun) {
      viewKind = "hill";
      viewLabels.push("Hügelblick");
    }
    if (visibleWater.length) viewLabels.push(visibleWater.some((feature) => ["lake", "reservoir", "water"].includes(feature.subtype ?? "")) ? "Seeblick" : "Wasserblick");
    if (openness >= 0.75) viewLabels.push("Weitsicht");
    if ((inForest || forestShare >= .35) && naturalness >= 0.7) viewLabels.push("Waldumgebung");
    if (openness < 0.4 || meanHorizon > 22 || selectedBlockedShare >= 0.5) {
      viewKind = "none";
      const scenic = new Set(["Bergblick", "Hügelblick", "Weitsicht"]);
      for (let index = viewLabels.length - 1; index >= 0; index -= 1) if (scenic.has(viewLabels[index])) viewLabels.splice(index, 1);
      viewLabels.push("Eingeschränkte Aussicht");
    }
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
    landContext,
    waterfront: distanceWaterMeters === null ? null : distanceWaterMeters <= 75,
    canopyContext,
    distanceForestMeters,
    distanceWaterMeters,
    distancePathMeters,
    distanceBuildingMeters,
    buildingCount100m: buildings.filter((feature) => featureDistance(latitude, longitude, feature) <= 100).length,
    buildingCount350m: nearBuildings.length,
    treeCount350m: nearTrees.length,
    vegetationMedianHeight,
    vegetationMaxHeight,
    nearOpennessPercent: Math.round((1 - nearBlockedShare) * 100),
    viewScore,
    viewComponents,
    viewLabels,
    viewExplanation,
    visibleTerrainMaxMeters,
    viewKind,
  };
}
