import "server-only";

import type Database from "better-sqlite3";
import type { BenchObservationSummary, LightObservationChoice, ViewObservationChoice } from "@/lib/types";
import { blendedViewEstimate, directionalOpenness, lightTrend, type ObjectiveView, type ViewEvidence } from "./model";

type ViewRow = {
  user_id: number;
  kind: "agreement" | "correction";
  observed_at: string;
  openness: ViewObservationChoice["openness"] | null;
  sky: ViewObservationChoice["sky"] | null;
  relief: ViewObservationChoice["relief"] | null;
  water: ViewObservationChoice["water"] | null;
  horizon: ViewObservationChoice["horizon"] | null;
  naturalness: ViewObservationChoice["naturalness"] | null;
  disturbance: ViewObservationChoice["disturbance"] | null;
};

function viewEvidence(rows: ViewRow[]): ViewEvidence[] {
  return rows.map((row) => ({
    userId: row.user_id,
    kind: row.kind,
    observedAt: row.observed_at,
    values: row.kind === "correction" && row.openness && row.sky && row.relief && row.water && row.horizon && row.naturalness && row.disturbance
      ? { openness: row.openness, sky: row.sky, relief: row.relief, water: row.water, horizon: row.horizon, naturalness: row.naturalness, disturbance: row.disturbance }
      : null,
  }));
}

export function refreshEnvironmentEstimate(database: Database.Database, benchRowId: number) {
  const enrichment = database.prepare(`
    SELECT e.view_components,e.obstruction_types,e.building_obstruction_percent,e.vegetation_obstruction_percent,
      b.direction_degrees
    FROM bench_enrichments e JOIN benches b ON b.row_id=e.bench_row_id WHERE e.bench_row_id=?
  `).get(benchRowId) as {
    view_components: string | null;
    obstruction_types: string | null;
    building_obstruction_percent: number | null;
    vegetation_obstruction_percent: number | null;
    direction_degrees: number | null;
  } | undefined;
  let storedComponents: Partial<Omit<ObjectiveView, "openness" | "sky"> & { openness: number | null }> = {};
  try { storedComponents = enrichment?.view_components ? JSON.parse(enrichment.view_components) : {}; } catch { /* retain unknown objective values */ }
  let obstructionTypes: string[] = [];
  try { obstructionTypes = enrichment?.obstruction_types ? JSON.parse(enrichment.obstruction_types) : []; } catch { /* retain unknown directional openness */ }
  const objective: ObjectiveView = {
    openness: directionalOpenness(obstructionTypes, enrichment?.direction_degrees ?? null),
    sky: storedComponents.openness ?? null,
    relief: storedComponents.relief ?? null,
    water: storedComponents.water ?? null,
    naturalness: storedComponents.naturalness ?? null,
    remoteness: storedComponents.remoteness ?? null,
  };
  const building = Math.max(0, Math.min(1, (enrichment?.building_obstruction_percent ?? 0) / 100));
  const trees = Math.max(0, Math.min(1 - building, (enrichment?.vegetation_obstruction_percent ?? 0) / 100));
  const rows = database.prepare("SELECT * FROM bench_view_observations WHERE bench_row_id=? AND retracted_at IS NULL ORDER BY observed_at DESC")
    .all(benchRowId) as ViewRow[];
  const estimate = blendedViewEstimate(viewEvidence(rows), objective, { open: Math.max(0, 1 - building - trees), trees, buildings: building });
  if (!estimate) {
    database.prepare("DELETE FROM bench_environment_estimates WHERE bench_row_id=?").run(benchRowId);
    return;
  }
  database.prepare(`
    INSERT INTO bench_environment_estimates(bench_row_id,components,horizon,community_contributors,confidence,model_version,computed_at)
    VALUES(?,?,?,?,?,'community-shrinkage-1',?)
    ON CONFLICT(bench_row_id) DO UPDATE SET components=excluded.components,horizon=excluded.horizon,
      community_contributors=excluded.community_contributors,confidence=excluded.confidence,
      model_version=excluded.model_version,computed_at=excluded.computed_at
  `).run(benchRowId, JSON.stringify(estimate.components), JSON.stringify(estimate.horizon), estimate.contributors, estimate.confidence, new Date().toISOString());
}

export function readBenchObservationSummary(
  database: Database.Database,
  benchRowId: number,
  currentUserId: number | null,
  season: string,
  dayPhase: string,
): BenchObservationSummary {
  const lightRows = database.prepare(`
    SELECT user_id,choice,observed_at FROM bench_light_observations
    WHERE bench_row_id=? AND retracted_at IS NULL AND season=? AND day_phase=?
      AND observed_at>=datetime('now','-90 days') ORDER BY observed_at DESC
  `).all(benchRowId, season, dayPhase) as Array<{ user_id: number; choice: LightObservationChoice; observed_at: string }>;
  const myLight = currentUserId === null ? undefined : database.prepare(`
    SELECT choice,observed_at FROM bench_light_observations
    WHERE bench_row_id=? AND user_id=? AND retracted_at IS NULL
    ORDER BY observed_at DESC LIMIT 1
  `).get(benchRowId, currentUserId) as { choice: LightObservationChoice; observed_at: string } | undefined;
  const viewRows = database.prepare("SELECT * FROM bench_view_observations WHERE bench_row_id=? AND retracted_at IS NULL ORDER BY observed_at DESC")
    .all(benchRowId) as ViewRow[];
  const myView = currentUserId === null ? undefined : viewRows.find((row) => row.user_id === currentUserId);
  const stored = database.prepare("SELECT components,horizon,community_contributors,confidence FROM bench_environment_estimates WHERE bench_row_id=?")
    .get(benchRowId) as { components: string; horizon: string; community_contributors: number; confidence: number } | undefined;
  return {
    light: {
      mine: myLight ? { choice: myLight.choice, observedAt: myLight.observed_at } : null,
      publicTrend: lightTrend(lightRows.map((row) => ({ userId: row.user_id, choice: row.choice, observedAt: row.observed_at }))),
    },
    view: {
      mine: myView ? { kind: myView.kind, observedAt: myView.observed_at } : null,
      publicEstimate: stored && stored.community_contributors >= 3 ? {
        contributors: stored.community_contributors,
        components: JSON.parse(stored.components),
        horizon: JSON.parse(stored.horizon),
        confidence: stored.confidence,
      } : null,
    },
  };
}
