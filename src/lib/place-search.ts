import type { PlaceResult } from "@/lib/types";

export function normalizeLocationKey(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("de-CH").trim();
}

export async function searchGeoAdminLocations(query: string, fetcher: typeof fetch = fetch): Promise<PlaceResult[]> {
  const url = new URL("https://api3.geo.admin.ch/rest/services/api/SearchServer");
  url.searchParams.set("searchText", query);
  url.searchParams.set("type", "locations");
  // Do not send an `origins` filter: GeoAdmin currently returns no results when
  // municipality, postcode and district origins are combined in one request.
  url.searchParams.set("limit", "12");
  url.searchParams.set("sr", "4326");
  try {
    const response = await fetcher(url, { next: { revalidate: 86400 } });
    if (!response.ok) return [];
    const data = await response.json() as { results?: Array<{ id?: string | number; attrs?: Record<string, string | number> }> };
    return (data.results ?? []).flatMap((result) => {
      const attrs = result.attrs ?? {};
      const latitude = Number(attrs.lat ?? attrs.y);
      const longitude = Number(attrs.lon ?? attrs.x);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      const label = String(attrs.label ?? attrs.detail ?? query).replace(/<[^>]*>/g, "");
      return [{ id: String(result.id ?? `${latitude}-${longitude}`), label, latitude, longitude, kind: "place" as const }];
    });
  } catch { return []; }
}
