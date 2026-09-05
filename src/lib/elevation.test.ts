import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTerrainHorizon, parsePointHeight } from "@/integrations/geoadmin/elevation";
import { wgs84ToLv95 } from "./elevation";

afterEach(() => vi.restoreAllMocks());

describe("point elevation helpers", () => {
  it("converts WGS84 to plausible LV95 coordinates", () => {
    const zurich = wgs84ToLv95(47.37674, 8.54183);
    expect(zurich.easting).toBeCloseTo(2_683_314, 0);
    expect(zurich.northing).toBeCloseTo(1_247_908, 0);
  });

  it("accepts numeric GeoAdmin height strings and rejects invalid values", () => {
    expect(parsePointHeight({ height: "428.7" })).toBe(428.7);
    expect(parsePointHeight({ height: "not-a-height" })).toBeNull();
    expect(parsePointHeight({ height: "9000" })).toBeNull();
  });

  it("builds all 72 dense terrain-horizon bins from two bounded profile requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const coordinates = JSON.parse(new URLSearchParams(String(init?.body)).get("geom") ?? "{}").coordinates as number[][];
      return new Response(JSON.stringify(coordinates.map((_coordinate, index) => ({ alts: { COMB: index === 0 ? 500 : 510 } }))), { status: 200 });
    }));
    const result = await fetchTerrainHorizon(47.37674, 8.54183);
    expect(result?.horizonProfile).toHaveLength(72);
    expect(result?.sampleElevations).toHaveLength(72 * 106);
    expect(result?.elevationMeters).toBe(500);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
