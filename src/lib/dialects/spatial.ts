import "server-only";

import geography from "../../../config/dialects/areas.generated.json";
import type { Language } from "@/i18n/config";
import type { DialectSpatialResolution } from "./model";

type Position = number[];
type PolygonCoordinates = Position[][];
type Geometry = { type: "Polygon"; coordinates: PolygonCoordinates } | { type: "MultiPolygon"; coordinates: PolygonCoordinates[] };
type Bounds = [number, number, number, number];

function visitPositions(value: unknown, visitor: (position: Position) => void): void {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    visitor(value as Position);
    return;
  }
  for (const child of value) visitPositions(child, visitor);
}

function bounds(geometry: Geometry): Bounds {
  const result: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  visitPositions(geometry.coordinates, ([longitude, latitude]) => {
    result[0] = Math.min(result[0], longitude);
    result[1] = Math.min(result[1], latitude);
    result[2] = Math.max(result[2], longitude);
    result[3] = Math.max(result[3], latitude);
  });
  return result;
}

function insideBounds(longitude: number, latitude: number, value: Bounds) {
  return longitude >= value[0] && longitude <= value[2] && latitude >= value[1] && latitude <= value[3];
}

function onSegment(longitude: number, latitude: number, a: Position, b: Position) {
  const cross = (longitude - a[0]) * (b[1] - a[1]) - (latitude - a[1]) * (b[0] - a[0]);
  return Math.abs(cross) < 1e-10
    && longitude >= Math.min(a[0], b[0]) && longitude <= Math.max(a[0], b[0])
    && latitude >= Math.min(a[1], b[1]) && latitude <= Math.max(a[1], b[1]);
}

function insideRing(longitude: number, latitude: number, ring: Position[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[previous];
    const b = ring[index];
    if (onSegment(longitude, latitude, a, b)) return true;
    if ((a[1] > latitude) !== (b[1] > latitude)
      && longitude < ((b[0] - a[0]) * (latitude - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function insidePolygon(longitude: number, latitude: number, polygon: PolygonCoordinates) {
  return Boolean(polygon[0]) && insideRing(longitude, latitude, polygon[0])
    && polygon.slice(1).every((hole) => !insideRing(longitude, latitude, hole));
}

function insideGeometry(longitude: number, latitude: number, geometry: Geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => insidePolygon(longitude, latitude, polygon));
}

function segmentDistanceSquared(longitude: number, latitude: number, a: Position, b: Position) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const ratio = length === 0 ? 0 : Math.max(0, Math.min(1, ((longitude - a[0]) * dx + (latitude - a[1]) * dy) / length));
  const x = a[0] + ratio * dx;
  const y = a[1] + ratio * dy;
  return (longitude - x) ** 2 + (latitude - y) ** 2;
}

function geometryDistanceSquared(longitude: number, latitude: number, geometry: Geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let nearest = Infinity;
  for (const polygon of polygons) for (const ring of polygon) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      nearest = Math.min(nearest, segmentDistanceSquared(longitude, latitude, ring[previous], ring[index]));
    }
  }
  return nearest;
}

const territory = geography.territory as Geometry;
const territoryBounds = bounds(territory);
const areas = geography.features.map((feature) => ({
  areaId: feature.properties.areaId,
  geometry: feature.geometry as Geometry,
  bounds: bounds(feature.geometry as Geometry),
}));
const languageAreas = geography.languageAreas.map((feature) => ({
  language: feature.properties.language as Language,
  geometry: feature.geometry as Geometry,
  bounds: bounds(feature.geometry as Geometry),
}));
const languageAreaFallbacks = geography.languageAreaFallbacks.map((feature) => ({
  language: feature.properties.language as Language,
  geometry: feature.geometry as Geometry,
  bounds: bounds(feature.geometry as Geometry),
}));

function languageAt(longitude: number, latitude: number) {
  const direct = [...languageAreas, ...languageAreaFallbacks]
    .find((area) => insideBounds(longitude, latitude, area.bounds) && insideGeometry(longitude, latitude, area.geometry))?.language;
  if (direct) return direct;
  // Independent simplification can open metre-scale seams along shared borders.
  // Repair only a <=55 m seam; this is not a nearest-region geographic fallback.
  const nearest = languageAreas.map((area) => ({ language: area.language, distance: geometryDistanceSquared(longitude, latitude, area.geometry) }))
    .sort((left, right) => left.distance - right.distance)[0];
  return nearest && nearest.distance <= 0.0005 ** 2 ? nearest.language : null;
}

export function spatialDialectResolution(latitude: number, longitude: number): DialectSpatialResolution {
  const valid = Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  const insideSwitzerland = valid && insideBounds(longitude, latitude, territoryBounds) && insideGeometry(longitude, latitude, territory);
  return {
    insideSwitzerland,
    areaIds: insideSwitzerland
      ? areas.filter((area) => insideBounds(longitude, latitude, area.bounds) && insideGeometry(longitude, latitude, area.geometry)).map((area) => area.areaId)
      : [],
    languageArea: insideSwitzerland ? languageAt(longitude, latitude) : null,
    sourceVersion: `${geography.metadata.generatedFrom}+sprg20220501`,
  };
}
