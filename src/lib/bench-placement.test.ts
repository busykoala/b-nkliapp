import { describe, expect, it } from "vitest";
import { benchPlacement } from "./bench-placement";
import { benchSpriteArt } from "./bench-scene-art";

describe("painted bench ground alignment", () => {
  it("keeps every bench's foot centroid on its scene's ground at all supported sizes", () => {
    for (const material of ["Holz", "Metall", "Stein"]) for (const shape of [
      { backrest: true, armrests: true }, { backrest: true, armrests: false }, { backrest: false, armrests: false },
    ]) for (const scene of ["country", "harbour", "lake", "forest", "city", "village", "alpine"])
      for (const seats of [1, 3, 6, NaN]) {
        const p = benchPlacement(scene, benchSpriteArt({ material, ...shape }), seats);
        const points = p.contacts.map((foot) => ({
          x: p.translateX + p.scale * foot.x,
          y: p.translateY + p.scale * (foot.y + p.slope * foot.x),
        }));
        expect(points.reduce((s, point) => s + point.x, 0) / 4).toBeCloseTo(p.ground.x);
        expect(points.reduce((s, point) => s + point.y, 0) / 4).toBeCloseTo(p.ground.y);
        for (const point of points) {
          expect(point.y).toBeGreaterThan(375);
          expect(point.y).toBeLessThan(465);
          expect(point.x).toBeGreaterThan(175);
          expect(point.x).toBeLessThan(470);
        }
      }
  });

  it("calibrates backless feet separately and keeps upright supports vertical", () => {
    const back = benchPlacement("harbour", benchSpriteArt({ material: "Holz", backrest: true, armrests: false }), 3);
    const backless = benchPlacement("harbour", benchSpriteArt({ material: "Holz", backrest: false, armrests: false }), 3);
    expect(backless.translateY).toBeGreaterThan(back.translateY);
    expect(back.transform).toContain("matrix(1 -0.1 0 1 0 0)");
    expect(backless.contacts).not.toEqual(back.contacts);
  });
});
