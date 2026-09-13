import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

function key(kind: string, benchId: string) {
  return createHash("sha256").update(`${kind}:${benchId}`).digest("hex");
}

export function installPanoramaFixture(benchId: string, covered?: boolean) {
  const databasePath = process.env.BENCHLY_E2E_DATABASE!;
  const cacheRoot = process.env.BENCHLY_E2E_PANORAMA_CACHE!;
  const database = new Database(databasePath);
  const now = new Date().toISOString();
  const bench = database.prepare("SELECT row_id,id,latitude,longitude FROM benches WHERE id=?")
    .get(benchId) as { row_id: number; id: string; latitude: number; longitude: number };
  const renderKey = key("render", benchId);
  const lightKey = key("light", benchId);
  const geometryKey = key("geometry", benchId);
  const renderDirectory = join(cacheRoot, "renders-v19", renderKey.slice(0, 2));
  const lightDirectory = join(cacheRoot, "lightmaps-v1", lightKey.slice(0, 2));
  const artifact = join(renderDirectory, `${renderKey}.webp`);
  const lightArtifact = join(lightDirectory, `${lightKey}.webp`);
  mkdirSync(renderDirectory, { recursive: true });
  mkdirSync(lightDirectory, { recursive: true });
  copyFileSync(join(process.cwd(), "public/map-art/textures/mountain.webp"), artifact);
  copyFileSync(join(process.cwd(), "public/map-art/textures/paper.webp"), lightArtifact);
  if (covered !== undefined) database.prepare("UPDATE benches SET covered=? WHERE row_id=?").run(Number(covered), bench.row_id);
  database.prepare(`INSERT OR REPLACE INTO bench_panorama_geometry(
    bench_row_id,bench_id,bench_latitude,bench_longitude,geometry_key,artifact_path,status,complete,
    source_versions_json,algorithm_version,warnings_json,artifact_bytes,started_at,generated_at,updated_at,error
  ) VALUES(?,?,?,?,?,?,'ready',1,'{}','panorama-geometry-4','[]',1,?,?,?,NULL)`).run(
    bench.row_id, bench.id, bench.latitude, bench.longitude, geometryKey,
    join(cacheRoot, "geometry-v4", `${geometryKey}.npz`), now, now, now,
  );
  database.prepare(`INSERT OR REPLACE INTO bench_panorama_renders(
    bench_row_id,geometry_key,render_key,artifact_path,status,style_version,center_azimuth_degrees,
    horizontal_fov_degrees,width,height,weather_bucket,solar_lunar_bucket,bench_variant,covered,
    artifact_bytes,generated_at,updated_at,error,season_bucket,artifact_format,source_completeness
  ) VALUES(?,?,?,?,'ready','panorama-watercolor-19',0,360,4096,1024,'dynamic-client-v1','dynamic-client-v1','overlay-v1',NULL,?,?,?,NULL,'autumn','webp','complete')`).run(
    bench.row_id, geometryKey, renderKey, artifact, statSync(artifact).size, now, now,
  );
  database.prepare(`INSERT OR REPLACE INTO bench_panorama_lightmaps(
    bench_row_id,geometry_key,light_key,solar_bucket,sun_azimuth_degrees,sun_altitude_degrees,
    artifact_path,status,artifact_bytes,generated_at,expires_at,updated_at,error
  ) VALUES(?,?,?,? ,180,40,?,'ready',?,?, '2099-01-01T00:00:00Z',?,NULL)`).run(
    bench.row_id, geometryKey, lightKey, now, lightArtifact, statSync(lightArtifact).size, now, now,
  );
  database.close();
}
