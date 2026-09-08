import { describe, expect, it } from "vitest";
import { wgs84ToLv95 } from "./elevation";

describe("coordinate conversion", () => {
  it("converts WGS84 to plausible LV95 coordinates", () => {
    const zurich = wgs84ToLv95(47.37674, 8.54183);
    expect(zurich.easting).toBeCloseTo(2_683_314, 0);
    expect(zurich.northing).toBeCloseTo(1_247_908, 0);
  });

});
