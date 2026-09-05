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
    expect(results).toEqual([{ id: "42", label: "Därligen (BE)", latitude: 46.6518, longitude: 7.8103, kind: "place" }]);
  });

  it("fails softly when the network is unavailable", async () => {
    expect(await searchGeoAdminLocations("Mürren", vi.fn(async () => { throw new Error("offline"); }) as typeof fetch)).toEqual([]);
  });

  it("preserves address types for journey-origin results", async () => {
    const results = await searchGeoAdminLocations("Seestrasse 1", async () => Response.json({ results: [{ id: 1, attrs: { label: "Seestrasse 1", lat: 46.68, lon: 7.69, origin: "address" } }] }));
    expect(results[0].kind).toBe("address");
  });
});
