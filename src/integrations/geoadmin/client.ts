import { DATA_RUNTIME } from "@/data/runtime.generated";
import type { PlaceResult } from "@/lib/types";

export type SwissLocation = { name: string; postcode: string | null; canton: string | null };
type IdentifyResult = { layerBodId?: string; attributes?: Record<string, string | number | boolean | null> };

export function normalizeLocationKey(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("de-CH").trim();
}

export async function searchGeoAdminLocations(query: string, fetcher: typeof fetch = fetch): Promise<PlaceResult[]> {
  const url = new URL(`${DATA_RUNTIME.geoAdminBaseUrl}/rest/services/api/SearchServer`);
  url.searchParams.set("searchText", query);
  url.searchParams.set("type", "locations");
  // GeoAdmin currently returns no results when municipality, postcode and
  // district origins are combined in one request, so intentionally omit it.
  url.searchParams.set("limit", "12");
  url.searchParams.set("sr", "4326");
  try {
    const response = await fetcher(url, { next: { revalidate: 86_400 } });
    if (!response.ok) return [];
    const data = await response.json() as { results?: Array<{ id?: string | number; attrs?: Record<string, string | number> }> };
    return (data.results ?? []).flatMap((result) => {
      const attrs = result.attrs ?? {};
      const latitude = Number(attrs.lat ?? attrs.y);
      const longitude = Number(attrs.lon ?? attrs.x);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      const label = String(attrs.label ?? attrs.detail ?? query).replace(/<[^>]*>/g, "");
      const kind: PlaceResult["kind"] = attrs.origin === "address" ? "address" : "place";
      return [{ id: String(result.id ?? `${latitude}-${longitude}`), label, latitude, longitude, kind }];
    });
  } catch { return []; }
}

export async function reverseGeocodeSwiss(latitude: number, longitude: number): Promise<SwissLocation | null> {
  const parameters = new URLSearchParams({
    geometryType: "esriGeometryPoint", geometry: `${longitude},${latitude}`, sr: "4326",
    imageDisplay: "0,0,0", mapExtent: "0,0,0,0", tolerance: "0",
    layers: "all:ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill,ch.swisstopo-vd.ortschaftenverzeichnis_plz",
    returnGeometry: "false",
  });
  try {
    const response = await fetch(`${DATA_RUNTIME.geoAdminBaseUrl}/rest/services/ech/MapServer/identify?${parameters}`, { next: { revalidate: 86_400 }, signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return null;
    const results = ((await response.json()) as { results?: IdentifyResult[] }).results ?? [];
    const postcode = results.find((item) => item.layerBodId === "ch.swisstopo-vd.ortschaftenverzeichnis_plz")?.attributes;
    const municipality = results
      .filter((item) => item.layerBodId === "ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill")
      .sort((left, right) => Number(right.attributes?.jahr ?? 0) - Number(left.attributes?.jahr ?? 0))[0]?.attributes;
    const name = String(postcode?.langtext ?? municipality?.gemname ?? "").trim();
    if (!name) return null;
    return { name, postcode: postcode?.plz == null ? null : String(postcode.plz), canton: municipality?.kanton == null ? null : String(municipality.kanton) };
  } catch { return null; }
}

