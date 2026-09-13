"use server";

import type { BenchDetail, MapBenchListResult, MapFeature, MapQuery, PlaceResult } from "@/lib/types";
import { readVerifiedBenchDetail } from "@/features/bench-detail/service";
import { readMapBenchList, readMapFeatures } from "@/features/map/service";
import { searchMapPlaces } from "@/features/map/search";
import { getCurrentUser } from "@/lib/security";
import { withRequestDialect } from "@/lib/dialects/presentation";

export async function getMapFeatures(input: MapQuery): Promise<MapFeature[]> {
  return readMapFeatures(input);
}

export async function getMapBenchList(input: MapQuery): Promise<MapBenchListResult> {
  return readMapBenchList(input);
}

export async function getBenchDetail(benchId: string): Promise<BenchDetail | null> {
  return withRequestDialect(await readVerifiedBenchDetail(benchId, await getCurrentUser()));
}

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  return searchMapPlaces(query);
}
