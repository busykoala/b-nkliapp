import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { notFound } from "next/navigation";
import { readBenchDetail } from "@/features/bench-detail/service";
import { sqlite } from "@/db/client";
import { calculateSunState, type ObstructionType } from "@/lib/sun";
import { applyArtScenario, type ArtScenario } from "../../../../scripts/panorama-art/scenarios";
import catalogue from "../../../../config/panorama-artist-review.json";
import { ArtReviewViewer } from "./viewer";

type ReviewBench = { id: string; scenarios: ArtScenario[] };
export default async function PanoramaArtReview({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.BENCHLY_PANORAMA_REVIEW !== "1") notFound();
  const params = await searchParams;
  const entry = catalogue.benches.find((bench) => bench.number === Number(params.bench ?? 7) || bench.id === params.bench);
  const number = entry?.number ?? 0;
  const stage = typeof params.stage === "string" ? params.stage : "baseline-v1";
  const season = typeof params.season === "string" ? params.season : "autumn";
  const condition = typeof params.condition === "string" ? params.condition : "noon-clear";
  if (!entry || !/^[a-zA-Z0-9_-]+$/.test(stage)) notFound();
  const manifest = JSON.parse(await readFile(resolve("data/panorama-artist-review/scenarios.json"), "utf8")) as { benches: ReviewBench[] };
  const scene = manifest.benches.find((bench) => bench.id === entry.id)?.scenarios.find((scene) => scene.id === condition && scene.season === season);
  const detail = readBenchDetail(entry.id, null);
  if (!scene || !detail) notFound();
  const asset = (name: string) => `/dev/panorama-review/assets?path=${encodeURIComponent(`${stage}/${entry.id}/${name}.webp`)}`;
  const bench = applyArtScenario(detail, scene);
  const solar = sqlite.prepare(`SELECT e.horizon_profile,e.obstruction_types FROM bench_enrichments e
    JOIN benches b ON b.row_id=e.bench_row_id WHERE b.id=?`).get(entry.id) as { horizon_profile: string; obstruction_types: string } | undefined;
  if (solar) {
    const sunlight = calculateSunState({ latitude: bench.latitude, longitude: bench.longitude,
      horizonProfile: JSON.parse(solar.horizon_profile || "[]"), obstructionTypes: JSON.parse(solar.obstruction_types || "[]") as ObstructionType[],
      covered: bench.covered, canopyPercent: bench.canopyPercent, date: new Date(scene.at) });
    bench.sunnyNow = sunlight.sunny;
    bench.shadeCause = sunlight.shadeCause;
  }
  const variants = ["neutral", ...["wood", "metal", "stone", "plastic"].flatMap((material) =>
    ["back-arm", "back", "backless"].map((shape) => `${material}-${shape}`))];
  const variant = typeof params.variant === "string" && variants.includes(params.variant) ? params.variant : "";
  if (variant) {
    const values = { material: variant.split("-")[0], backrest: variant === "neutral" ? "" : variant.endsWith("backless") ? "nein" : "ja",
      armrest: variant.endsWith("back-arm") ? "ja" : "nein" };
    bench.properties = bench.properties.filter((property) => !Object.hasOwn(values, property.key));
    for (const key of ["material", "backrest", "armrest"] as const)
      bench.properties.push({ key, label: key, value: values[key], source: "Bänkli App" });
  }
  const iteration = JSON.parse(await readFile(resolve(`test-results/panorama-artist-review/${stage}/manifest.json`), "utf8")) as {
    seasons: string[];
    benches: { id: string; diagnostics: { minimumElevation: number; maximumElevation: number } }[];
  };
  const geometry = iteration.benches.find((bench) => bench.id === entry.id)?.diagnostics;
  if (!geometry) notFound();
  // The on-demand worker paints a neutral summer base; the actual client
  // applies seasonal grading. Keep that same contract in the full matrix.
  // Early single-season experiments remain viewable with their baked palette.
  const baseSeason = iteration.seasons.includes("summer") ? "summer" : season;
  bench.directionDegrees = params.heading === "sky" ? scene.sun.altitude > 0 ? scene.sun.azimuth : scene.moon.azimuth : entry.heading;
  bench.panorama = { status: "ready", artifactUrl: asset(`base-${baseSeason}`), materialUrl: asset("material"),
    lightMapUrl: asset(`${season}-${condition}.light`), completeness: "complete",
    rasterBounds: { minimumAltitude: geometry.minimumElevation, maximumAltitude: geometry.maximumElevation } };
  bench.panoramaStatus = "ready";
  return <main style={{ padding: 16 }}>
    <h1>Bänkliview · Artist review</h1>
    <p>Local review · synthetic weather · astronomical sky at {scene.at} · base palette {baseSeason}, client season {season}</p>
    {variant && <p>Synthetic bench variant for asset review: {variant}. Location facts remain in the downloaded snapshot.</p>}
    <form style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      <label>Location <select name="bench" defaultValue={number}>{catalogue.benches.map((bench) => <option key={bench.id} value={bench.number}>{String(bench.number).padStart(2, "0")} {bench.name}</option>)}</select></label>
      <label>Iteration <input name="stage" defaultValue={stage} size={14} /></label>
      <label>Season <select name="season" defaultValue={season}>{["spring", "summer", "autumn", "winter"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Condition <select name="condition" defaultValue={condition}>{manifest.benches[0].scenarios.filter((scene) => scene.season === season).map((scene) => <option key={scene.id}>{scene.id}</option>)}</select></label>
      <label>Direction <select name="heading" defaultValue={params.heading === "sky" ? "sky" : "artist"}><option value="artist">Artist view</option><option value="sky">Sun / moon</option></select></label>
      <label>Bench <select name="variant" defaultValue={variant}><option value="">Recorded properties</option>{variants.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><input type="checkbox" name="hideBench" value="1" defaultChecked={params.hideBench === "1"} /> Hide bench</label>
      <button type="submit">Review</button>
    </form>
    <p><strong>Preserve:</strong> {entry.preserve}. <strong>Improve:</strong> {entry.improve}.</p>
    <ArtReviewViewer key={`${number}:${stage}:${season}:${condition}:${params.heading}:${variant}`} bench={bench} hideBench={params.hideBench === "1"} />
    <p>Sun {scene.sun.azimuth.toFixed(1)}° / {scene.sun.altitude.toFixed(1)}° · Moon {scene.moon.azimuth.toFixed(1)}° / {scene.moon.altitude.toFixed(1)}° · illuminated {(scene.moon.fraction * 100).toFixed(0)}% · cloud {(scene.weather.cloudCover! * 100).toFixed(0)}%</p>
  </main>;
}
