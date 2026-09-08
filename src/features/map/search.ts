import "server-only";

import { z } from "zod";
import { sqlite } from "@/db/client";
import { normalizeLocationKey, searchGeoAdminLocations } from "@/integrations/geoadmin/client";
import type { PlaceResult } from "@/lib/types";

type BenchSearchRow = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  location_name: string | null;
  location_canton: string | null;
};

type PlaceSearchRow = {
  location_name: string;
  location_postcode: string | null;
  location_canton: string | null;
  latitude: number;
  longitude: number;
};

export async function searchMapPlaces(input: string): Promise<PlaceResult[]> {
  const query = z.string().trim().min(2).max(80).parse(input);
  const normalized = normalizeLocationKey(query);
  const text = `%${query.toLocaleLowerCase("de-CH")}%`;
  const benches = sqlite.prepare(`
    SELECT id,coalesce(name,description,'Sitzbank') label,latitude,longitude,location_name,location_canton
    FROM benches
    WHERE active=1 AND (lower(coalesce(name,'')) LIKE ? OR lower(coalesce(description,'')) LIKE ?)
    ORDER BY name IS NOT NULL DESC,verification_status='verified' DESC,source_updated_at DESC LIMIT 6
  `).all(text, text) as BenchSearchRow[];
  const places = sqlite.prepare(`
    SELECT location_name,location_postcode,location_canton,avg(latitude) latitude,avg(longitude) longitude
    FROM benches WHERE active=1 AND (location_key LIKE ? OR lower(location_name) LIKE ?)
    GROUP BY location_key,location_postcode,location_canton ORDER BY count(*) DESC LIMIT 4
  `).all(`%${normalized}%`, text) as PlaceSearchRow[];

  const results: PlaceResult[] = [
    ...benches.map((bench) => ({
      id: `bench-${bench.id}`,
      label: [bench.label, bench.location_name, bench.location_canton].filter(Boolean).join(" · "),
      latitude: bench.latitude,
      longitude: bench.longitude,
      kind: "bench" as const,
      benchId: bench.id,
    })),
    ...places.map((place) => ({
      id: `local-${place.latitude}-${place.longitude}`,
      label: [place.location_postcode, place.location_name, place.location_canton].filter(Boolean).join(" "),
      latitude: place.latitude,
      longitude: place.longitude,
      kind: "place" as const,
    })),
    ...await searchGeoAdminLocations(query),
  ];
  return results.filter((item, index) => results.findIndex((candidate) => (
    candidate.label.toLocaleLowerCase("de-CH") === item.label.toLocaleLowerCase("de-CH")
  )) === index).slice(0, 8);
}
