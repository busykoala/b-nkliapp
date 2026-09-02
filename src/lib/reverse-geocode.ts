export type SwissLocation = { name: string; postcode: string | null; canton: string | null };

type IdentifyResult = {
  layerBodId?: string;
  attributes?: Record<string, string | number | boolean | null>;
};

export async function reverseGeocodeSwiss(latitude: number, longitude: number): Promise<SwissLocation | null> {
  const parameters = new URLSearchParams({
    geometryType: "esriGeometryPoint",
    geometry: `${longitude},${latitude}`,
    sr: "4326",
    imageDisplay: "0,0,0",
    mapExtent: "0,0,0,0",
    tolerance: "0",
    layers: "all:ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill,ch.swisstopo-vd.ortschaftenverzeichnis_plz",
    returnGeometry: "false",
  });
  try {
    const response = await fetch(`https://api3.geo.admin.ch/rest/services/ech/MapServer/identify?${parameters}`, { next: { revalidate: 86_400 }, signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return null;
    const payload = await response.json() as { results?: IdentifyResult[] };
    const results = payload.results ?? [];
    const postcode = results.find((item) => item.layerBodId === "ch.swisstopo-vd.ortschaftenverzeichnis_plz")?.attributes;
    const municipality = results
      .filter((item) => item.layerBodId === "ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill")
      .sort((left, right) => Number(right.attributes?.jahr ?? 0) - Number(left.attributes?.jahr ?? 0))[0]?.attributes;
    const name = String(postcode?.langtext ?? municipality?.gemname ?? "").trim();
    if (!name) return null;
    return {
      name,
      postcode: postcode?.plz === undefined || postcode.plz === null ? null : String(postcode.plz),
      canton: municipality?.kanton === undefined || municipality.kanton === null ? null : String(municipality.kanton),
    };
  } catch {
    return null;
  }
}
