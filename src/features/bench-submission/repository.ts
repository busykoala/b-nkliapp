import "server-only";

import { sqlite } from "@/db/client";
import { distanceMeters } from "@/lib/journey";
import type { NearbyBench } from "@/lib/types";

export function readNearbyBenches(latitude: number, longitude: number): NearbyBench[] {
  const radius = 25;
  const latitudeDelta = radius / 110_000;
  const longitudeDelta = latitudeDelta / Math.cos(latitude * Math.PI / 180);
  const rows = sqlite.prepare(`
    SELECT b.id,coalesce(nullif(b.name,''),nullif(b.description,''),'Bänkli') title,b.latitude,b.longitude
    FROM bench_spatial_index s JOIN benches b ON b.row_id=s.row_id
    WHERE s.min_longitude BETWEEN ? AND ? AND s.min_latitude BETWEEN ? AND ? AND b.active=1
  `).all(longitude - longitudeDelta, longitude + longitudeDelta, latitude - latitudeDelta, latitude + latitudeDelta) as Omit<NearbyBench, "distanceMeters">[];
  return rows.map((bench) => ({ ...bench, distanceMeters: distanceMeters({ label: "Position", latitude, longitude }, { ...bench, label: bench.title }) }))
    .filter((bench) => bench.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));
}
