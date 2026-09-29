import { createHash, randomInt, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";

// Cleanup is limited to IDs created by this process, not every community bench.
const ownedPanoramaBenches = new Set<string>();

function key(kind: string, benchId: string) {
  return createHash("sha256").update(`${kind}:${benchId}`).digest("hex");
}

export function installPanoramaFixture(benchId: string, covered?: boolean,
  assets?: { painting: Buffer; material: Buffer }) {
  const databasePath = process.env.BENCHLY_E2E_DATABASE!;
  const cacheRoot = process.env.BENCHLY_E2E_PANORAMA_CACHE!;
  const database = new Database(databasePath);
  const now = new Date().toISOString();
  const bench = database.prepare("SELECT row_id,id,latitude,longitude FROM benches WHERE id=?")
    .get(benchId) as { row_id: number; id: string; latitude: number; longitude: number };
  const renderKey = key("render", benchId);
  const lightKey = key("light", benchId);
  const geometryKey = key("geometry", benchId);
  const materialKey = key("material", benchId);
  const generationId = "e2e-generation";
  const renderDirectory = join(cacheRoot, "active", generationId, "renders", renderKey.slice(0, 2));
  const lightDirectory = join(cacheRoot, "active", generationId, "lightmaps", lightKey.slice(0, 2));
  const materialDirectory = join(cacheRoot, "active", generationId, "materials", materialKey.slice(0, 2));
  const artifact = join(renderDirectory, `${renderKey}.webp`);
  const lightArtifact = join(lightDirectory, `${lightKey}.webp`);
  const materialArtifact = join(materialDirectory, `${materialKey}.webp`);
  mkdirSync(renderDirectory, { recursive: true });
  mkdirSync(lightDirectory, { recursive: true });
  mkdirSync(materialDirectory, { recursive: true });
  if (assets) writeFileSync(artifact, assets.painting);
  else copyFileSync(join(process.cwd(), "public/map-art/textures/mountain.webp"), artifact);
  copyFileSync(join(process.cwd(), "public/map-art/textures/paper.webp"), lightArtifact);
  // One transparent pixel is a truthful all-sky semantic mask (material G=0).
  // A decorative paper texture marked every pixel as solid terrain and made
  // celestial occlusion impossible to exercise in the browser fixture.
  writeFileSync(materialArtifact, assets?.material
    ?? Buffer.from("UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAcQEf0PRET/Aw==", "base64"));
  database.prepare(`INSERT OR IGNORE INTO panorama_generations
    (id,git_commit,state,source_versions_json,created_at,activated_at)
    VALUES(?,'0123456789abcdef','active','{}',?,?)`).run(generationId, now, now);
  if (covered !== undefined) database.prepare("UPDATE benches SET covered=? WHERE row_id=?").run(Number(covered), bench.row_id);
  database.prepare(`INSERT OR REPLACE INTO bench_panorama_geometry(
    bench_row_id,bench_id,bench_latitude,bench_longitude,geometry_key,artifact_path,status,complete,
    source_versions_json,algorithm_version,warnings_json,artifact_bytes,started_at,generated_at,updated_at,error,
    generation_id,capsule_format
  ) VALUES(?,?,?,?,?,?,'ready',1,'{}','geometry-implementation-hash','[]',1,?,?,?,NULL,?,'benchly-view-capsule')`).run(
    bench.row_id, bench.id, bench.latitude, bench.longitude, geometryKey,
    join(cacheRoot, "active", generationId, "capsules", `${geometryKey}.bpc`), now, now, now, generationId,
  );
  database.prepare(`INSERT OR REPLACE INTO bench_panorama_renders(
    bench_row_id,geometry_key,render_key,artifact_path,status,style_version,center_azimuth_degrees,
    horizontal_fov_degrees,width,height,weather_bucket,solar_lunar_bucket,bench_variant,covered,
    artifact_bytes,generated_at,updated_at,error,season_bucket,artifact_format,source_completeness,
    generation_id,material_key,material_path,material_bytes
  ) VALUES(?,?,?,?,'ready','render-implementation-hash',0,360,4096,1024,'dynamic-client','dynamic-client','overlay',NULL,?,?,?,NULL,'dynamic','webp','complete',?,?,?,?)`).run(
    bench.row_id, geometryKey, renderKey, artifact, statSync(artifact).size, now, now,
    generationId, materialKey, materialArtifact, statSync(materialArtifact).size,
  );
  database.prepare(`INSERT OR REPLACE INTO bench_panorama_lightmaps(
    bench_row_id,geometry_key,light_key,solar_bucket,sun_azimuth_degrees,sun_altitude_degrees,
    artifact_path,status,artifact_bytes,generated_at,expires_at,updated_at,error
  ) VALUES(?,?,?,? ,180,40,?,'ready',?,?, '2099-01-01T00:00:00Z',?,NULL)`).run(
    bench.row_id, geometryKey, lightKey, now, lightArtifact, statSync(lightArtifact).size, now, now,
  );
  database.close();
}

export async function installTerrainPanoramaFixture(benchId: string, covered?: boolean) {
  // The narrow 149° summit crosses the fixed daytime fixture's solar disc.
  // It is intentional: browser screenshots can prove partial-disc occlusion,
  // not merely that the canvas has a higher z-index than the body.
  const ridge = "M0 184 C95 153 151 173 226 151 C322 121 376 179 455 163 C474 155 484 54 497 42 C510 54 522 154 545 163 C566 166 588 156 612 149 C705 115 770 175 846 158 C925 140 1017 178 1100 153 C1144 140 1173 163 1200 184 L1200 300 L0 300 Z";
  const painting = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300" viewBox="0 0 1200 300">
    <rect width="1200" height="300" fill="#a8c8d2"/>
    <path d="${ridge}" fill="#758c79"/>
    <path d="M0 217 C145 180 248 230 373 190 C509 154 615 226 748 188 C900 151 1016 221 1200 181 L1200 300 L0 300 Z" fill="#657b63" opacity=".84"/>
    <path d="M545 147 L545 111 L575 111 L575 153 Z" fill="#887b68"/>
    <path d="M539 112 L560 93 L582 112 Z" fill="#6b6257"/>
    <path d="M0 270 C210 249 387 287 591 260 C808 233 978 285 1200 255 L1200 300 L0 300 Z" fill="#9b9870" opacity=".7"/>
  </svg>`;
  const material = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300" viewBox="0 0 1200 300">
    <rect width="1200" height="300" fill="rgb(0,0,0)"/>
    <path d="${ridge}" fill="rgb(74,128,150)"/>
    <path d="M545 147 L545 111 L575 111 L575 153 Z M539 112 L560 93 L582 112 Z" fill="rgb(42,230,128)"/>
  </svg>`;
  // Finish the comparatively slow SVG rasterisation before making the DB row
  // visible. This prevents the polling browser from caching the all-sky seed
  // asset in the few milliseconds before the matching mask replaces it.
  const [paintingBuffer, materialBuffer] = await Promise.all([
    sharp(Buffer.from(painting)).webp({ quality: 92 }).toBuffer(),
    sharp(Buffer.from(material)).webp({ lossless: true }).toBuffer(),
  ]);
  installPanoramaFixture(benchId, covered, { painting: paintingBuffer, material: materialBuffer });
}

/** Each test owns its bench and artifacts; copy the seed facts, not mutable render state. */
export function createIsolatedPanoramaBench(): string {
  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  try {
    const source = database.prepare("SELECT * FROM benches WHERE id='osm-node-109'").get() as Record<string, unknown> | undefined;
    if (!source) throw new Error("Panorama seed bench has not been installed");
    // Use the same public ID format as a real contributed bench. A custom test
    // prefix is rejected by both readBenchDetail and readPanoramaArtifact.
    const id = `community-${randomUUID()}`;
    // Column names come from our own schema, never an external request.
    const columns = Object.keys(source).filter((name) => name !== "row_id");
    const values: Record<string, unknown> = { ...source, id, osm_id: -randomInt(1, 2_000_000_000) };
    database.transaction(() => {
      const result = database.prepare(`INSERT INTO benches (${columns.map((name) => `"${name}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
        .run(...columns.map((name) => values[name]));
      for (const table of ["bench_enrichments", "bench_geography"] as const) {
        const seed = database.prepare(`SELECT * FROM ${table} WHERE bench_row_id=?`).get(source.row_id) as Record<string, unknown> | undefined;
        if (!seed) continue;
        const fields = Object.keys(seed);
        database.prepare(`INSERT INTO ${table} (${fields.map((name) => `"${name}"`).join(",")}) VALUES (${fields.map(() => "?").join(",")})`)
          .run(...fields.map((name) => name === "bench_row_id" ? result.lastInsertRowid : seed[name]));
      }
    })();
    ownedPanoramaBenches.add(id);
    return id;
  } finally { database.close(); }
}

export function removeIsolatedPanoramaBench(id: string) {
  if (!ownedPanoramaBenches.has(id)) throw new Error("Refusing to remove a bench not owned by this fixture");
  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  try {
    database.pragma("foreign_keys = ON");
    database.prepare("DELETE FROM benches WHERE id=?").run(id);
    ownedPanoramaBenches.delete(id);
  } finally { database.close(); }
}
