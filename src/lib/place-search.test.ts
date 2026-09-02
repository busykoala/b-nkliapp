import { describe, expect, it, vi } from "vitest";
import { normalizeLocationKey, searchGeoAdminLocations } from "./place-search";

describe("place search", () => {
  it("normalizes Swiss place names for local lookup", () => {
    expect(normalizeLocationKey("  Därligen  ")).toBe("darligen");
    expect(normalizeLocationKey("Zürich")).toBe("zurich");
  });

  it("queries all GeoAdmin location origins and converts its results", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ results: [{
      id: 42, attrs: { label: "<b>Därligen (BE)</b>", lat: 46.6518, lon: 7.8103, origin: "gg25" },
    }] }), { status: 200 }));
    const results = await searchGeoAdminLocations("Därligen", fetcher as typeof fetch);
    const requested = new URL(String(fetcher.mock.calls[0][0]));
    expect(requested.searchParams.has("origins")).toBe(false);
    expect(results).toEqual([{ id: "42", label: "Därligen (BE)", latitude: 46.6518, longitude: 7.8103 }]);
  });

  it("fails softly when the network is unavailable", async () => {
    expect(await searchGeoAdminLocations("Mürren", vi.fn(async () => { throw new Error("offline"); }) as typeof fetch)).toEqual([]);
  });
});
