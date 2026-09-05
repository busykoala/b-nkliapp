"use server";
import { z } from "zod";
import { consumeRateLimit, getContributorIdentity } from "@/lib/security";
import { discoverWalks } from "@/lib/walks/provider";
import type { WalkResult } from "@/lib/walks/model";

const querySchema = z.object({
  origin: z.object({ kind: z.enum(["location", "address", "station"]), label: z.string().min(1).max(180), latitude: z.number().min(45.7).max(47.9), longitude: z.number().min(5.9).max(10.6), stationId: z.string().regex(/^\d{1,12}$/).optional() }),
  minutes: z.union([z.literal(30), z.literal(50), z.literal(120)]), shape: z.enum(["loop", "one-way"]), light: z.enum(["any", "sun", "shade"]),
  speed: z.union([z.literal(3), z.literal(4.2), z.literal(5.4)]), difficulty: z.enum(["easy", "t2"]), time: z.iso.datetime({ offset: true }),
});
export async function getWalkSuggestions(input: unknown): Promise<WalkResult> {
  const query = querySchema.parse(input);
  const { ipHash } = await getContributorIdentity(); consumeRateLimit(ipHash, "walk-plan", 6, 60);
  if (Math.abs(Date.parse(query.time) - Date.now()) > 366 * 86400000) throw new Error("Bitte ein Datum innerhalb eines Jahres wählen.");
  return discoverWalks(query);
}
