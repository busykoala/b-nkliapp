export type ProjectedPoint = [easting: number, northing: number];

export type ExactGeometry = {
  paths: ProjectedPoint[][];
  polygons: ProjectedPoint[][][];
};

type Cursor = { view: DataView; offset: number };

function readUint32(cursor: Cursor, littleEndian: boolean) {
  const value = cursor.view.getUint32(cursor.offset, littleEndian);
  cursor.offset += 4;
  return value;
}

function readPoint(cursor: Cursor, littleEndian: boolean, dimensions: number): ProjectedPoint {
  const point: ProjectedPoint = [
    cursor.view.getFloat64(cursor.offset, littleEndian),
    cursor.view.getFloat64(cursor.offset + 8, littleEndian),
  ];
  cursor.offset += dimensions * 8;
  return point;
}

function merge(into: ExactGeometry, value: ExactGeometry) {
  into.paths.push(...value.paths);
  into.polygons.push(...value.polygons);
}

function parseGeometry(cursor: Cursor): ExactGeometry {
  const littleEndian = cursor.view.getUint8(cursor.offset) === 1;
  cursor.offset += 1;
  const rawType = readUint32(cursor, littleEndian);
  const unflaggedType = rawType & 0x0fffffff;
  const dimensions = unflaggedType >= 3000 ? 4
    : unflaggedType >= 1000 ? 3
      : (rawType & 0x80000000 ? 1 : 0) + (rawType & 0x40000000 ? 1 : 0) + 2;
  const type = unflaggedType >= 1000 ? unflaggedType % 1000 : unflaggedType;
  if (rawType & 0x20000000) readUint32(cursor, littleEndian); // EWKB SRID
  const result: ExactGeometry = { paths: [], polygons: [] };
  if (type === 1) {
    result.paths.push([readPoint(cursor, littleEndian, dimensions)]);
  } else if (type === 2) {
    const count = readUint32(cursor, littleEndian);
    result.paths.push(Array.from({ length: count }, () => readPoint(cursor, littleEndian, dimensions)));
  } else if (type === 3) {
    const ringCount = readUint32(cursor, littleEndian);
    const rings = Array.from({ length: ringCount }, () => {
      const count = readUint32(cursor, littleEndian);
      return Array.from({ length: count }, () => readPoint(cursor, littleEndian, dimensions));
    });
    result.polygons.push(rings);
    result.paths.push(...rings);
  } else if (type >= 4 && type <= 7) {
    const count = readUint32(cursor, littleEndian);
    for (let index = 0; index < count; index += 1) merge(result, parseGeometry(cursor));
  } else {
    throw new Error(`Unsupported WKB geometry type ${rawType}`);
  }
  return result;
}

export function parseWkbGeometry(value: Uint8Array): ExactGeometry {
  const cursor = { view: new DataView(value.buffer, value.byteOffset, value.byteLength), offset: 0 };
  const result = parseGeometry(cursor);
  if (cursor.offset > value.byteLength) throw new Error("Truncated WKB geometry");
  return result;
}

function pointSegmentDistance(point: ProjectedPoint, start: ProjectedPoint, end: ProjectedPoint) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
  ));
  const nearest: ProjectedPoint = [start[0] + ratio * dx, start[1] + ratio * dy];
  return { nearest, distance: Math.hypot(point[0] - nearest[0], point[1] - nearest[1]) };
}

function ringContains(point: ProjectedPoint, ring: ProjectedPoint[]) {
  const doubledArea = ring.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = ring[(index + 1) % ring.length];
    return sum + x * nextY - nextX * y;
  }, 0);
  // Projected vertical faces from 3D solids collapse to lines. They are useful
  // for distance, but must never claim that a bench lies inside a building.
  if (Math.abs(doubledArea) < 0.02) return false;
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x, y] = ring[current];
    const [previousX, previousY] = ring[previous];
    if (pointSegmentDistance(point, ring[previous], ring[current]).distance < 1e-7) return true;
    if ((y > point[1]) !== (previousY > point[1])
      && point[0] < (previousX - x) * (point[1] - y) / (previousY - y) + x) inside = !inside;
  }
  return inside;
}

export function geometryContains(point: ProjectedPoint, geometry: ExactGeometry) {
  return geometry.polygons.some((rings) => rings.length > 0
    && ringContains(point, rings[0])
    && !rings.slice(1).some((hole) => ringContains(point, hole)));
}

export function nearestGeometryPoint(point: ProjectedPoint, geometry: ExactGeometry) {
  if (geometryContains(point, geometry)) return { nearest: point, distance: 0 };
  let best: { nearest: ProjectedPoint; distance: number } | null = null;
  for (const path of geometry.paths) {
    if (path.length === 1) {
      const distance = Math.hypot(point[0] - path[0][0], point[1] - path[0][1]);
      if (!best || distance < best.distance) best = { nearest: path[0], distance };
      continue;
    }
    for (let index = 1; index < path.length; index += 1) {
      const candidate = pointSegmentDistance(point, path[index - 1], path[index]);
      if (!best || candidate.distance < best.distance) best = candidate;
    }
  }
  return best;
}

/** Distances at which a ray enters and leaves an exact projected geometry. */
export function rayGeometrySpan(origin: ProjectedPoint, bearingDegrees: number, geometry: ExactGeometry) {
  const radians = bearingDegrees * Math.PI / 180;
  const direction: ProjectedPoint = [Math.sin(radians), Math.cos(radians)];
  const distances: number[] = [];
  for (const path of geometry.paths) {
    for (let index = 1; index < path.length; index += 1) {
      const start = path[index - 1];
      const end = path[index];
      const segment: ProjectedPoint = [end[0] - start[0], end[1] - start[1]];
      const offset: ProjectedPoint = [start[0] - origin[0], start[1] - origin[1]];
      const denominator = direction[0] * segment[1] - direction[1] * segment[0];
      if (Math.abs(denominator) < 1e-9) continue;
      const rayDistance = (offset[0] * segment[1] - offset[1] * segment[0]) / denominator;
      const segmentRatio = (offset[0] * direction[1] - offset[1] * direction[0]) / denominator;
      if (rayDistance >= 0 && segmentRatio >= 0 && segmentRatio <= 1) distances.push(rayDistance);
    }
  }
  const unique = distances.sort((a, b) => a - b).filter((value, index, values) => index === 0 || value - values[index - 1] > .05);
  if (geometryContains(origin, geometry)) unique.unshift(0);
  if (!unique.length) return null;
  return { entry: unique[0], exit: unique[1] ?? unique[0] };
}
