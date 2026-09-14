import "server-only";

import { sqlite } from "@/db/client";
import type { PanoramaDescriptor, PanoramaStatus } from "@/features/bench-panorama/types";

export type { PanoramaDescriptor, PanoramaStatus } from "@/features/bench-panorama/types";

const BENCH_ID = /^(osm-(node|way)-\d+|community-[0-9a-f-]{36}|inventory-[0-9a-f]{24})$/;
const ARTIFACT_KEY = /^[0-9a-f]{64}$/;

export type PanoramaArtifact = {
  artifactPath: string;
  renderKey: string;
  generatedAt: string | null;
  completeness: "complete" | "partial";
  lightKey: string | null;
  materialKey: string | null;
  generationId: string;
};

export function readPanoramaArtifact(benchId: string): PanoramaArtifact | null {
  if (!BENCH_ID.test(benchId)) return null;
  return sqlite.prepare(`
    SELECT pr.artifact_path artifactPath,pr.render_key renderKey,pr.generated_at generatedAt,
      pr.source_completeness completeness,
      pr.material_key materialKey,pr.generation_id generationId,
      (SELECT light_key FROM bench_panorama_lightmaps pl
        WHERE pl.bench_row_id=b.row_id AND pl.geometry_key=pg.geometry_key
          AND pl.status='ready' AND pl.artifact_path IS NOT NULL
          AND julianday(pl.generated_at)>=julianday('now','-20 minutes')
        ORDER BY pl.generated_at DESC,pl.id DESC LIMIT 1) lightKey
    FROM benches b
    JOIN bench_panorama_geometry pg ON pg.bench_row_id=b.row_id
    JOIN bench_panorama_renders pr
      ON pr.bench_row_id=pg.bench_row_id AND pr.geometry_key=pg.geometry_key
    JOIN panorama_generations generation ON generation.id=pr.generation_id AND generation.state='active'
    WHERE b.id=? AND b.active=1
      AND pg.bench_id=b.id
      AND abs(pg.bench_latitude-b.latitude)<=1e-9
      AND abs(pg.bench_longitude-b.longitude)<=1e-9
      AND pg.status='ready' AND pr.status='ready' AND pr.horizontal_fov_degrees=360
      AND pr.artifact_format='webp' AND pr.season_bucket='dynamic'
      AND pr.artifact_path IS NOT NULL
    ORDER BY pr.generated_at DESC,pr.id DESC LIMIT 1
  `).get(benchId) as PanoramaArtifact | undefined ?? null;
}

export function readPanoramaDescriptor(benchId: string): PanoramaDescriptor {
  const artifact = readPanoramaArtifact(benchId);
  if (artifact) return {
    status: "ready",
    renderKey: artifact.renderKey,
    artifactUrl: `/media/panorama/${artifact.renderKey}`,
    lightMapUrl: artifact.lightKey ? `/media/panorama/${artifact.lightKey}` : undefined,
    materialUrl: artifact.materialKey ? `/media/panorama/${artifact.materialKey}` : undefined,
    generatedAt: artifact.generatedAt,
    completeness: artifact.completeness,
    generationId: artifact.generationId,
  };
  if (!BENCH_ID.test(benchId)) return { status: "unavailable" };
  const stale = sqlite.prepare(`
    SELECT pr.render_key renderKey,pr.generated_at generatedAt,pr.source_completeness completeness,
      pr.material_key materialKey,pr.generation_id generationId
    FROM benches b
    JOIN bench_panorama_geometry pg ON pg.bench_row_id=b.row_id
    JOIN bench_panorama_renders pr ON pr.bench_row_id=b.row_id AND pr.geometry_key=pg.geometry_key
    WHERE b.id=? AND b.active=1 AND pg.bench_id=b.id
      AND abs(pg.bench_latitude-b.latitude)<=1e-9
      AND abs(pg.bench_longitude-b.longitude)<=1e-9
      AND pr.status='ready' AND pr.horizontal_fov_degrees=360
      AND pr.artifact_format='webp' AND pr.artifact_path IS NOT NULL
    ORDER BY pr.generated_at DESC,pr.id DESC LIMIT 1
  `).get(benchId) as Pick<PanoramaArtifact, "renderKey" | "generatedAt" | "completeness" | "materialKey" | "generationId"> | undefined;
  const row = sqlite.prepare(`
    SELECT pg.status geometryStatus,
      EXISTS(SELECT 1 FROM bench_panorama_requests request WHERE request.bench_row_id=b.row_id) requested
    FROM benches b LEFT JOIN bench_panorama_geometry pg ON pg.bench_row_id=b.row_id
    WHERE b.id=? AND b.active=1
  `).get(benchId) as { geometryStatus: PanoramaStatus | null; requested: number } | undefined;
  if (!row) return { status: "unavailable" };
  if (stale) return {
    status: "stale",
    renderKey: stale.renderKey,
    artifactUrl: `/media/panorama/${stale.renderKey}`,
    materialUrl: stale.materialKey ? `/media/panorama/${stale.materialKey}` : undefined,
    generatedAt: stale.generatedAt,
    completeness: stale.completeness,
    generationId: stale.generationId,
    retryAfterMs: 5_000,
  };
  if (row.requested || row.geometryStatus === "generating" || row.geometryStatus === "stale") {
    return { status: row.geometryStatus === "stale" ? "stale" : "generating", retryAfterMs: 5_000 };
  }
  if (row.geometryStatus === "error") return { status: "error", retryAfterMs: 30_000 };
  return { status: "unavailable", retryAfterMs: 5_000 };
}

export function readArtifactByKey(key: string): { artifactPath: string; etag: string } | null {
  if (!ARTIFACT_KEY.test(key)) return null;
  const render = sqlite.prepare(`SELECT artifact_path artifactPath,render_key etag
    FROM bench_panorama_renders render
    JOIN panorama_generations generation ON generation.id=render.generation_id AND generation.state='active'
    WHERE render_key=? AND status='ready'
      AND artifact_format='webp' AND artifact_path IS NOT NULL LIMIT 1`)
    .get(key) as { artifactPath: string; etag: string } | undefined;
  if (render) return render;
  const material = sqlite.prepare(`SELECT material_path artifactPath,material_key etag
    FROM bench_panorama_renders render
    JOIN panorama_generations generation ON generation.id=render.generation_id AND generation.state='active'
    WHERE material_key=? AND status='ready'
      AND material_path IS NOT NULL LIMIT 1`)
    .get(key) as { artifactPath: string; etag: string } | undefined;
  if (material) return material;
  return sqlite.prepare(`SELECT artifact_path artifactPath,light_key etag
    FROM bench_panorama_lightmaps WHERE light_key=? AND status='ready'
      AND artifact_path IS NOT NULL AND (expires_at IS NULL OR julianday(expires_at)>julianday('now')) LIMIT 1`)
    .get(key) as { artifactPath: string; etag: string } | undefined ?? null;
}

export function enqueuePanoramaRequest(benchId: string) {
  if (!BENCH_ID.test(benchId)) return false;
  if (readPanoramaArtifact(benchId)) {
    sqlite.prepare(`DELETE FROM bench_panorama_requests
      WHERE bench_row_id=(SELECT row_id FROM benches WHERE id=? AND active=1)`)
      .run(benchId);
    return false;
  }
  const result = sqlite.prepare(`
    INSERT INTO bench_panorama_requests(bench_row_id,requested_at,status,priority,next_attempt_at)
    SELECT b.row_id,?,'pending',0,NULL FROM benches b
    WHERE b.id=? AND b.active=1 AND NOT EXISTS (
      SELECT 1 FROM bench_panorama_geometry pg
      JOIN bench_panorama_renders pr
        ON pr.bench_row_id=pg.bench_row_id AND pr.geometry_key=pg.geometry_key
      JOIN panorama_generations generation
        ON generation.id=pr.generation_id AND generation.state='active'
      WHERE pg.bench_row_id=b.row_id AND pg.bench_id=b.id
        AND abs(pg.bench_latitude-b.latitude)<=1e-9
        AND abs(pg.bench_longitude-b.longitude)<=1e-9
        AND pg.status='ready' AND pr.status='ready'
        AND pr.horizontal_fov_degrees=360 AND pr.artifact_format='webp'
        AND pr.season_bucket='dynamic' AND pr.artifact_path IS NOT NULL
    )
    ON CONFLICT(bench_row_id) DO UPDATE SET
      requested_at=min(bench_panorama_requests.requested_at,excluded.requested_at),
      status='pending',priority=min(bench_panorama_requests.priority,excluded.priority),
      lease_owner=NULL,lease_until=NULL,next_attempt_at=NULL
  `).run(new Date().toISOString(), benchId);
  return result.changes > 0;
}
