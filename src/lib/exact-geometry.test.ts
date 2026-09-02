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
});
