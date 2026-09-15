"use server";

import { z } from "zod";
import { loadStoredWalkDraft, removeStoredWalkDraft, storeWalkDraftState } from "@/lib/walk-draft-store";

const origin = z.object({
  kind: z.enum(["location", "address", "station"]), label: z.string().min(1).max(180),
  labelKind: z.enum(["location", "station", "bench", "waypoint"]).optional(),
  latitude: z.number().min(45.7).max(47.9), longitude: z.number().min(5.9).max(10.6),
  stationId: z.string().regex(/^\d{1,12}$/).optional(),
});
const state = z.object({
  origin: origin.nullable(),
  settings: z.object({
    minutes: z.union([z.literal(30), z.literal(50), z.literal(120)]),
    shape: z.enum(["loop", "one-way"]), light: z.enum(["any", "sun", "shade"]),
    difficulty: z.enum(["easy", "t2"]), speed: z.union([z.literal(3), z.literal(4.2), z.literal(5.4)]),
    time: z.string().max(32), maxRestMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]).optional(),
  }),
  selected: z.string().max(128), extras: z.boolean(), dirty: z.boolean().optional(),
});

export async function getWalkDraft() {
  return loadStoredWalkDraft();
}

export async function saveWalkDraft(input: unknown) {
  await storeWalkDraftState(state.parse(input));
}

export async function discardWalkDraft() {
  await removeStoredWalkDraft();
}
