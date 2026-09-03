import { describe, expect, it } from "vitest";
import { geometryContains, nearestGeometryPoint, parseWkbGeometry } from "./exact-geometry";

function polygonWkb(ring: Array<[number, number]>) {
  const buffer = Buffer.alloc(1 + 4 + 4 + 4 + ring.length * 16);
  let offset = 0;
  buffer.writeUInt8(1, offset); offset += 1;
  buffer.writeUInt32LE(3, offset); offset += 4;
  buffer.writeUInt32LE(1, offset); offset += 4;
  buffer.writeUInt32LE(ring.length, offset); offset += 4;
  for (const [x, y] of ring) {
    buffer.writeDoubleLE(x, offset); buffer.writeDoubleLE(y, offset + 8); offset += 16;
  }
  return buffer;
}

function polygonZWkb(ring: Array<[number, number, number]>) {
  const buffer = Buffer.alloc(1 + 4 + 4 + 4 + ring.length * 24);
  let offset = 0;
  buffer.writeUInt8(1, offset); offset += 1;
  buffer.writeUInt32LE(1003, offset); offset += 4;
  buffer.writeUInt32LE(1, offset); offset += 4;
  buffer.writeUInt32LE(ring.length, offset); offset += 4;
  for (const [x, y, z] of ring) {
    buffer.writeDoubleLE(x, offset); buffer.writeDoubleLE(y, offset + 8); buffer.writeDoubleLE(z, offset + 16); offset += 24;
  }
  return buffer;
}

describe("exact projected WKB geometry", () => {
  const concave = parseWkbGeometry(polygonWkb([
    [0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10], [0, 0],
  ]));

  it("does not confuse a concave polygon with its bounding box", () => {
    expect(geometryContains([5, 7], concave)).toBe(false);
    expect(geometryContains([1, 7], concave)).toBe(true);
  });

  it("returns the actual nearest edge rather than a bounding-box distance", () => {
    expect(nearestGeometryPoint([5, 7], concave)?.distance).toBeCloseTo(2);
  });

  it("reads the Z coordinates used by swissBUILDINGS3D without shifting XY", () => {
    const building = parseWkbGeometry(polygonZWkb([
      [0, 0, 420], [10, 0, 420], [10, 10, 431], [0, 10, 431], [0, 0, 420],
    ]));
    expect(geometryContains([5, 5], building)).toBe(true);
    expect(nearestGeometryPoint([15, 5], building)?.distance).toBeCloseTo(5);
  });
});
