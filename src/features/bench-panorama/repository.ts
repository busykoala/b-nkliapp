import "server-only";

import { sqlite } from "@/db/client";

const BENCH_ID = /^(osm-(node|way)-\d+|community-[0-9a-f-]{36}|inventory-[0-9a-f]{24})$/;

export type PanoramaArtifact = {
  artifactPath: string;
  renderKey: string;
  generatedAt: string | null;
};

export function readPanoramaArtifact(benchId: string): PanoramaArtifact | null {
  if (!BENCH_ID.test(benchId)) return null;
  return sqlite.prepare(`
    SELECT pr.artifact_path artifactPath,pr.render_key renderKey,pr.generated_at generatedAt
    FROM benches b
    JOIN bench_panorama_geometry pg ON pg.bench_row_id=b.row_id
    JOIN bench_panorama_renders pr
      ON pr.bench_row_id=pg.bench_row_id AND pr.geometry_key=pg.geometry_key
    WHERE b.id=? AND b.active=1
      AND pg.bench_id=b.id AND pg.bench_latitude=b.latitude AND pg.bench_longitude=b.longitude
      AND pg.status='ready' AND pr.status='ready' AND pr.horizontal_fov_degrees=360
      AND pr.artifact_path IS NOT NULL
    ORDER BY pr.generated_at DESC,pr.id DESC LIMIT 1
  `).get(benchId) as PanoramaArtifact | undefined ?? null;
}

export function enqueuePanoramaRequest(benchId: string) {
  if (!BENCH_ID.test(benchId)) return false;
  const result = sqlite.prepare(`
    INSERT INTO bench_panorama_requests(bench_row_id,requested_at)
    SELECT row_id,? FROM benches WHERE id=? AND active=1
    ON CONFLICT(bench_row_id) DO UPDATE SET requested_at=excluded.requested_at
  `).run(new Date().toISOString(), benchId);
  return result.changes > 0;
}
