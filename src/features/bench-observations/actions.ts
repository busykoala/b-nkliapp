"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sqlite } from "@/db/client";
import { loadWeatherGrid, sampleWeatherGrid } from "@/integrations/weather/repository";
import { assertContributorAllowed, consumeRateLimit, contributorHashForUser, getContributorIdentity, requireUser } from "@/lib/security";
import type { ActionResult } from "@/lib/types";
import { benchObservationNow, lightObservationContext, observationSeason } from "./context";
import { refreshEnvironmentEstimate } from "./repository";

const lightSchema = z.enum(["sun", "shade", "mixed"]);
const viewSchema = z.object({
  openness: z.enum(["wide", "partial", "enclosed"]),
  sky: z.enum(["open", "partial", "closed"]),
  relief: z.enum(["flat", "gentle", "strong"]),
  water: z.enum(["clear", "some", "none"]),
  horizon: z.enum(["open", "trees", "buildings", "mixed"]),
  naturalness: z.enum(["natural", "mixed", "built"]),
  disturbance: z.enum(["quiet", "some", "strong"]),
});

type BenchRow = { row_id: number; latitude: number; longitude: number };

function benchRow(benchId: string) {
  const row = sqlite.prepare("SELECT row_id,latitude,longitude FROM benches WHERE id=? AND active=1").get(benchId) as BenchRow | undefined;
  if (!row) throw new Error("Dieses Bänkli wurde nicht gefunden.");
  return row;
}

async function actor(action: string, dailyLimit: number) {
  const user = await requireUser();
  const identity = await getContributorIdentity();
  const contributorHash = contributorHashForUser(user.id);
  assertContributorAllowed(contributorHash);
  consumeRateLimit(contributorHash, `${action}-day`, dailyLimit, 86400);
  consumeRateLimit(identity.ipHash, `${action}-ip-day`, dailyLimit * 3, 86400);
  return user;
}

function refresh(benchId: string) {
  revalidatePath("/");
  revalidatePath(`/bank/${benchId}`);
}

export async function submitLightObservation(benchId: string, choiceInput: unknown): Promise<ActionResult> {
  const choice = lightSchema.safeParse(choiceInput);
  if (!choice.success) return { ok: false, message: "Bitte wähle Sonne, Schatten oder Wechselhaft." };
  try {
    const user = await actor("light-observation", 12);
    const bench = benchRow(benchId);
    const now = benchObservationNow();
    const context = lightObservationContext(now, bench.latitude, bench.longitude);
    if (!context) return { ok: false, message: "Lichteindrücke kannst du hier erst wieder bei Tageslicht melden." };
    const { season, dayPhase } = context;
    const cloudGrid = loadWeatherGrid("CLCT");
    const cloudCover = cloudGrid ? sampleWeatherGrid(cloudGrid, bench.latitude, bench.longitude) : null;
    const recent = sqlite.prepare(`
      SELECT id FROM bench_light_observations WHERE bench_row_id=? AND user_id=? AND retracted_at IS NULL
        AND observed_at>=datetime('now','-30 minutes') ORDER BY observed_at DESC LIMIT 1
    `).get(bench.row_id, user.id) as { id: number } | undefined;
    if (recent) {
      sqlite.prepare("UPDATE bench_light_observations SET choice=?,observed_at=?,season=?,day_phase=?,cloud_cover=? WHERE id=?")
        .run(choice.data, now.toISOString(), season, dayPhase, cloudCover, recent.id);
    } else {
      sqlite.prepare(`INSERT INTO bench_light_observations(bench_row_id,user_id,choice,observed_at,season,day_phase,cloud_cover,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(bench.row_id, user.id, choice.data, now.toISOString(), season, dayPhase, cloudCover, now.toISOString());
    }
    refresh(benchId);
    return { ok: true, message: "Danke – dein Lichteindruck ist eingetragen." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Der Lichteindruck konnte nicht gespeichert werden." };
  }
}

export async function undoLightObservation(benchId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const bench = benchRow(benchId);
    sqlite.prepare(`UPDATE bench_light_observations SET retracted_at=? WHERE id=(
      SELECT id FROM bench_light_observations WHERE bench_row_id=? AND user_id=? AND retracted_at IS NULL ORDER BY observed_at DESC LIMIT 1
    )`).run(benchObservationNow().toISOString(), bench.row_id, user.id);
    refresh(benchId);
    return { ok: true, message: "Deine Beobachtung wurde zurückgenommen." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Die Beobachtung konnte nicht zurückgenommen werden." };
  }
}

function replaceViewObservation(benchRowId: number, userId: number, kind: "agreement" | "correction", values: z.infer<typeof viewSchema> | null) {
  const now = benchObservationNow().toISOString();
  const season = observationSeason(new Date(now));
  const transaction = sqlite.transaction(() => {
    sqlite.prepare("UPDATE bench_view_observations SET retracted_at=? WHERE bench_row_id=? AND user_id=? AND retracted_at IS NULL")
      .run(now, benchRowId, userId);
    sqlite.prepare(`INSERT INTO bench_view_observations(
      bench_row_id,user_id,kind,openness,sky,relief,water,horizon,naturalness,disturbance,season,observed_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      benchRowId, userId, kind, values?.openness ?? null, values?.sky ?? null, values?.relief ?? null,
      values?.water ?? null, values?.horizon ?? null, values?.naturalness ?? null, values?.disturbance ?? null,
      season, now, now,
    );
    refreshEnvironmentEstimate(sqlite, benchRowId);
  });
  transaction();
}

export async function submitViewAgreement(benchId: string): Promise<ActionResult> {
  try {
    const user = await actor("view-observation", 8);
    const bench = benchRow(benchId);
    replaceViewObservation(bench.row_id, user.id, "agreement", null);
    refresh(benchId);
    return { ok: true, message: "Danke – deine Bestätigung hilft bei der Einordnung." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Die Bestätigung konnte nicht gespeichert werden." };
  }
}

export async function submitViewObservation(benchId: string, input: unknown): Promise<ActionResult> {
  const values = viewSchema.safeParse(input);
  if (!values.success) return { ok: false, message: "Bitte vervollständige deinen Eindruck." };
  try {
    const user = await actor("view-observation", 8);
    const bench = benchRow(benchId);
    replaceViewObservation(bench.row_id, user.id, "correction", values.data);
    refresh(benchId);
    return { ok: true, message: "Danke – dein Eindruck ist eingetragen." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Der Eindruck konnte nicht gespeichert werden." };
  }
}

export async function deleteOwnObservation(benchId: string, kindInput: unknown): Promise<ActionResult> {
  const kind = z.enum(["light", "view"]).safeParse(kindInput);
  if (!kind.success) return { ok: false, message: "Unbekannte Beobachtung." };
  try {
    const user = await requireUser();
    const bench = benchRow(benchId);
    const now = benchObservationNow().toISOString();
    if (kind.data === "light") {
      sqlite.prepare("UPDATE bench_light_observations SET retracted_at=? WHERE bench_row_id=? AND user_id=? AND retracted_at IS NULL")
        .run(now, bench.row_id, user.id);
    } else {
      sqlite.prepare("UPDATE bench_view_observations SET retracted_at=? WHERE bench_row_id=? AND user_id=? AND retracted_at IS NULL")
        .run(now, bench.row_id, user.id);
      refreshEnvironmentEstimate(sqlite, bench.row_id);
    }
    refresh(benchId);
    return { ok: true, message: "Deine Beobachtung wurde gelöscht." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Die Beobachtung konnte nicht gelöscht werden." };
  }
}
