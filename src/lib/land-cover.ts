import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";

export const SWISSTOPO_LAND_COVER_VERSION = "swisstopo Base-Landbedeckung v1.0.0";

export type LandCoverEvidence = {
  centerClass: string | null;
  forestShare: number;
  naturalShare: number;
  forestBySector: number[];
  sampleCount: number;
  sourceVersion: typeof SWISSTOPO_LAND_COVER_VERSION;
};

type Position = [number, number];
type PolygonGeometry = { type: "Polygon"; coordinates: Position[][] };
type MultiPolygonGeometry = { type: "MultiPolygon"; coordinates: Position[][][] };
type CoverClass = { name: string; forest: boolean; natural: boolean };

const ZOOM = 14;
const TILE_COUNT = 2 ** ZOOM;
const TILE_URL = "https://vectortiles0.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0";
const tileCache = new Map<string, Promise<VectorTile | null>>();
const forestClasses = new Set(["forest", "wood", "loose_forest"]);
const naturalClasses = new Set(["forest", "wood", "loose_forest", "woody_plant", "scrub", "wetland", "swamp", "glacier", "ice", "rock", "park", "recreation_ground"]);

function tilePosition(latitude: number, longitude: number) {
  const x = (longitude + 180) / 360 * TILE_COUNT;
  const latitudeRadians = latitude * Math.PI / 180;
  const y = (1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * TILE_COUNT;
  return { tileX: Math.floor(x), tileY: Math.floor(y), x, y };
}

async function fetchTile(tileX: number, tileY: number) {
  const key = `${tileX}/${tileY}`;
  const existing = tileCache.get(key);
  if (existing) return existing;
  const request = (async () => {
    try {
      const response = await fetch(`${TILE_URL}/${ZOOM}/${tileX}/${tileY}.pbf`, {
        headers: { "User-Agent": "Benchly/1.0 (land-cover analysis)" },
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) return null;
      return new VectorTile(new Pbf(new Uint8Array(await response.arrayBuffer())));
    } catch {
      return null;
    }
  })();
  tileCache.set(key, request);
  if (tileCache.size > 128) tileCache.delete(tileCache.keys().next().value ?? key);
  return request;
}

function pointInRing(point: Position, ring: Position[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    if ((y > point[1]) !== (previousY > point[1])
      && point[0] < (previousX - x) * (point[1] - y) / (previousY - y) + x) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Position, polygon: Position[][]) {
  return polygon.length > 0 && pointInRing(point, polygon[0])
    && !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function pointInGeometry(point: Position, geometry: PolygonGeometry | MultiPolygonGeometry) {
  return geometry.type === "Polygon"
    ? pointInPolygon(point, geometry.coordinates)
    : geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
}

function coverClass(properties: Record<string, number | string | boolean>): CoverClass {
  const kind = String(properties.class ?? "").toLowerCase();
  const subtype = String(properties.subclass ?? "").toLowerCase();
  const name = subtype || kind;
  return {
    name,
    forest: forestClasses.has(kind) || forestClasses.has(subtype),
    natural: naturalClasses.has(kind) || naturalClasses.has(subtype),
  };
}

async function classifyPoint(latitude: number, longitude: number) {
  const position = tilePosition(latitude, longitude);
  const tile = await fetchTile(position.tileX, position.tileY);
  const layer = tile?.layers.landcover;
  if (!layer) return null;
  const point: Position = [longitude, latitude];
  let natural: CoverClass | null = null;
  for (let index = 0; index < layer.length; index += 1) {
    const feature = layer.feature(index);
    const candidate = coverClass(feature.properties);
    if (!candidate.natural || feature.type !== 3) continue;
    const geometry = feature.toGeoJSON(position.tileX, position.tileY, ZOOM).geometry;
    if ((geometry.type === "Polygon" || geometry.type === "MultiPolygon")
      && pointInGeometry(point, geometry as PolygonGeometry | MultiPolygonGeometry)) {
      if (candidate.forest) return candidate;
      natural ??= candidate;
    }
  }
  return natural ?? { name: "unclassified", forest: false, natural: false };
}

function offset(latitude: number, longitude: number, eastMeters: number, northMeters: number): Position {
  return [
    longitude + eastMeters / (111_320 * Math.max(.2, Math.cos(latitude * Math.PI / 180))),
    latitude + northMeters / 111_320,
  ];
}

/**
 * Samples the same official land-cover vector tiles that are visible on the map.
 * The rings describe the immediate setting, rather than treating a footpath-sized
 * clearing through woodland as a non-natural place.
 */
export async function fetchSwissLandCoverEvidence(latitude: number, longitude: number): Promise<LandCoverEvidence | null> {
  const rings = [30, 75, 150];
  const samples = [
    { point: [longitude, latitude] as Position, sector: null as number | null },
    ...rings.flatMap((radius) => Array.from({ length: 12 }, (_, sector) => {
      const angle = sector * Math.PI / 6;
      return { point: offset(latitude, longitude, Math.sin(angle) * radius, Math.cos(angle) * radius), sector };
    })),
  ];
  const classifications = await Promise.all(samples.map(({ point }) => classifyPoint(point[1], point[0])));
  if (classifications.every((value) => value === null)) return null;
  const resolved = classifications.map((value) => value ?? { name: "unclassified", forest: false, natural: false });
  const forestBySector = Array.from({ length: 12 }, (_, sector) => {
    const indices = samples.flatMap((sample, index) => sample.sector === sector ? [index] : []);
    return indices.filter((index) => resolved[index].forest).length / Math.max(1, indices.length);
  });
  return {
    centerClass: resolved[0].name === "unclassified" ? null : resolved[0].name,
    forestShare: resolved.filter((value) => value.forest).length / resolved.length,
    naturalShare: resolved.filter((value) => value.natural).length / resolved.length,
    forestBySector,
    sampleCount: resolved.length,
    sourceVersion: SWISSTOPO_LAND_COVER_VERSION,
  };
}
