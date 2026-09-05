"use server";

import { z } from "zod";
import { sqlite } from "@/db/client";
import { consumeRateLimit, getContributorIdentity } from "@/lib/security";
import { findStations, planJourney } from "@/lib/journey-provider";
import { searchGeoAdminLocations } from "@/integrations/geoadmin/client";
import type { JourneyOrigin, JourneyResult } from "@/lib/journey";

const origin = z.object({ kind: z.enum(["location", "address", "station"]), label: z.string().min(1).max(180), latitude: z.number().min(45.7).max(47.9), longitude: z.number().min(5.9).max(10.6), stationId: z.string().regex(/^\d{1,12}$/).optional() });
const destination = origin.omit({ kind: true, stationId: true });
const querySchema = z.object({ benchId: z.string().max(90).optional(), destination: destination.optional(), origin, mode: z.enum(["walk", "transit"]), time: z.iso.datetime({ offset: true }), arriveBy: z.boolean(), speedKmh: z.union([z.literal(3), z.literal(4.2), z.literal(5.4)]), bufferMinutes: z.union([z.literal(0), z.literal(3), z.literal(6), z.literal(10)]) }).refine((q) => Boolean(q.benchId) !== Boolean(q.destination), "Bitte genau ein Ziel wählen.");
export async function searchJourneyOrigins(input: string): Promise<JourneyOrigin[]> {
  const query = z.string().trim().min(2).max(80).parse(input);
  const { ipHash } = await getContributorIdentity(); consumeRateLimit(ipHash, "journey-search", 40, 60);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const results = await Promise.allSettled([findStations(query, controller.signal), searchGeoAdminLocations(query, (input) => {
      const url = new URL(String(input)); url.searchParams.set("origins", "address");
      // Typed addresses can be personal: never put them in Next's disk fetch cache.
      return fetch(url, { cache: "no-store", redirect: "error", signal: controller.signal });
    })]);
    const stations: JourneyOrigin[] = results[0].status === "fulfilled" ? results[0].value.map((p) => ({ ...p, kind: "station" })) : [];
    const addresses: JourneyOrigin[] = results[1].status === "fulfilled" ? results[1].value.filter((p) => p.kind === "address").map((p) => ({ label: p.label, latitude: p.latitude, longitude: p.longitude, kind: "address" })) : [];
    return [...stations.slice(0, 4), ...addresses.slice(0, 4)].filter((p) => origin.safeParse(p).success);
  } finally { clearTimeout(timer); }
}
export async function getJourney(input: unknown): Promise<JourneyResult> {
  const query = querySchema.parse(input);
  const { ipHash } = await getContributorIdentity(); consumeRateLimit(ipHash, "journey-plan", 8, 60);
  if (Math.abs(Date.parse(query.time) - Date.now()) > 366 * 86400000) throw new Error("Bitte ein Datum innerhalb eines Jahres wählen.");
  if (query.origin.kind === "station" && !query.origin.stationId) throw new Error("Bitte eine Haltestelle auswählen.");
  if (query.destination) return planJourney(query, query.destination);
  const bench = sqlite.prepare("SELECT latitude,longitude,coalesce(name,'Sitzbank') label FROM benches WHERE id=? AND active=1").get(query.benchId!) as { latitude: number; longitude: number; label: string } | undefined;
  if (!bench) throw new Error("Diese Bank ist nicht verfügbar.");
  return planJourney(query, bench);
}
