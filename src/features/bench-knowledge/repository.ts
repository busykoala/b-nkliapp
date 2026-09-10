import "server-only";
import { sqlite } from "@/db/client";
import { chooseVerificationQuestion, type AttributeKnowledge, type BenchKnowledge } from "./model";

type Row = Record<string, string | number | null>;
const text = (value: Row[string]) => value == null ? null : String(value);
const number = (value: Row[string]) => value == null ? null : Number(value);
const boolean = (value: Row[string]) => value == null ? null : Boolean(value);

export function readBenchKnowledge(rowId: number, userId?: number): BenchKnowledge {
  const attributes = (sqlite.prepare("SELECT * FROM bench_attribute_state WHERE bench_row_id=?").all(rowId) as Row[]).map((row): AttributeKnowledge => ({
    attribute: String(row.attribute), value: row.value_json == null ? null : JSON.parse(String(row.value_json)),
    confidence: row.confidence as AttributeKnowledge["confidence"], conflicting: Boolean(row.conflicting), evidenceCount: Number(row.evidence_count),
    sourceTypes: JSON.parse(String(row.source_types_json)), latestAt: text(row.latest_at), resolvedAt: String(row.resolved_at), freshness: row.freshness as AttributeKnowledge["freshness"], coverage: String(row.coverage),
  }));
  const geo = sqlite.prepare("SELECT * FROM bench_geography WHERE bench_row_id=?").get(rowId) as Row | undefined;
  const approach = sqlite.prepare("SELECT * FROM bench_approaches WHERE bench_row_id=?").get(rowId) as Row | undefined;
  const approachEvidence = JSON.parse(String(approach?.evidence_json ?? "{}"));
  const answered = userId ? (sqlite.prepare("SELECT attribute FROM bench_verification_answers WHERE bench_row_id=? AND user_id=? AND observed_at>=?").all(rowId, userId, new Date(Date.now() - 30 * 86_400_000).toISOString()) as { attribute: string }[]).map((row) => row.attribute) : [];
  const questionAttributes = attributes.map((item) => ({...item}));
  const original = sqlite.prepare("SELECT backrest,armrest,covered,material,osm_timestamp FROM benches WHERE row_id=?").get(rowId) as Row | undefined;
  for (const attribute of ["backrest", "armrest", "covered"]) {
    if (original?.[attribute] != null && !questionAttributes.some((item) => item.attribute === attribute)) {
      questionAttributes.push({ attribute, value: original[attribute], confidence: "low", conflicting: false,
        evidenceCount: 1, sourceTypes: [], latestAt: text(original.osm_timestamp) });
    }
  }
  const estimates = (sqlite.prepare(`SELECT e.* FROM bench_photo_estimates e JOIN benches b ON b.row_id=e.bench_row_id
    WHERE e.bench_row_id=? AND e.status='eligible' AND e.latitude=b.latitude AND e.longitude=b.longitude
    AND NOT EXISTS(SELECT 1 FROM bench_knowledge_queue q WHERE q.bench_row_id=b.row_id)`).all(rowId) as Row[])
    .filter((row) => {
      const state = attributes.find((item) => item.attribute === row.attribute);
      const value = JSON.parse(String(row.value_json));
      const confirmed = state ? state.value : original?.[String(row.attribute)];
      return !state?.conflicting && (confirmed == null || (typeof value === "boolean" ? Boolean(confirmed) === value : confirmed === value));
    }).map((row) => ({ attribute: String(row.attribute) as "backrest" | "armrest" | "material", value: JSON.parse(String(row.value_json)),
      imageHashes: JSON.parse(String(row.image_hashes_json)), modelVersion: String(row.model_version), promptVersion: String(row.prompt_version),
      capturedAt: text(row.captured_at), assessedAt: String(row.assessed_at), validationSamples: Number(row.validation_samples) }));
  // Unvalidated/contradictory photo evidence can prompt a human check without becoming a fact.
  for (const row of sqlite.prepare("SELECT attribute,status FROM bench_photo_estimates WHERE bench_row_id=? AND attribute IN ('backrest','armrest')").all(rowId) as Row[]) {
    if (row.status === "conflicting") {
      const state = questionAttributes.find((item) => item.attribute === row.attribute);
      if (state) state.conflicting = true;
      else questionAttributes.push({attribute: String(row.attribute), value: null, confidence: "unknown", conflicting: true, evidenceCount: 0, sourceTypes: ["imagery"], latestAt: null});
    }
  }
  return { attributes, photoEstimates: estimates, question: chooseVerificationQuestion(questionAttributes, answered),
    geography: geo ? { municipalityName: text(geo.municipality_name), municipalityId: text(geo.municipality_id), cantonName: text(geo.canton_name), districtName: text(geo.district_name), localityName: text(geo.locality_name), confidence: String(geo.confidence), sourceVersion: String(geo.source_version) } : null,
    amenities: (sqlite.prepare("SELECT * FROM bench_amenities WHERE bench_row_id=?").all(rowId) as Row[]).map((row) => ({ category: String(row.category), distanceMeters: number(row.distance_meters), sourceId: text(row.nearest_source_id), count100m: number(row.count_100m), count250m: number(row.count_250m), count500m: number(row.count_500m), distanceType: "straight_line" as const, computedAt: String(row.computed_at), sourceVersion: text(row.source_version), coverage: row.distance_meters == null ? "unknown" as const : "recorded" as const })),
    approach: approach ? { lengthMeters: number(approach.length_meters), maximumSlopePercent: number(approach.maximum_slope_percent), averageSlopePercent: number(approach.average_slope_percent), elevationGainMeters: number(approach.elevation_gain_meters), steps: boolean(approach.steps), surface: text(approach.surface), smoothness: text(approach.smoothness), widthMeters: number(approach.width_meters), stepFreePossible: boolean(approach.step_free_possible), confidence: String(approach.confidence), unmappedLastMeters: number(approach.distance_meters), terrainAmbiguity: approachEvidence.terrain_ambiguity ?? null, sampleCoverage: approachEvidence.dem_coverage ?? null, computedAt: String(approach.computed_at) } : null,
    noise: (sqlite.prepare("SELECT * FROM bench_noise_exposure WHERE bench_row_id=? ORDER BY mode,period").all(rowId) as Row[]).map((row) => ({ mode: row.mode as "road" | "rail", period: row.period as "day" | "night", value: number(row.value), unit: String(row.unit), datasetVersion: String(row.dataset_version) })),
    completeness: (sqlite.prepare("SELECT * FROM bench_completeness WHERE bench_row_id=? ORDER BY category").all(rowId) as Row[]).map((row) => ({ category: String(row.category), known: Number(row.known_count), total: Number(row.total_count), uncertain: Number(row.uncertain_count), missing: JSON.parse(String(row.missing_json)) })),
  };
}
