"use server";

import type { BenchDetail, MapFeature, MapQuery, PlaceResult } from "@/lib/types";
import { readVerifiedBenchDetail } from "@/features/bench-detail/service";
import { readMapFeatures } from "@/features/map/service";
import { searchMapPlaces } from "@/features/map/search";
import { getCurrentUser } from "@/lib/security";

export async function getMapFeatures(input: MapQuery): Promise<MapFeature[]> {
  return readMapFeatures(input);
}

export async function getBenchDetail(benchId: string): Promise<BenchDetail | null> {
  return readVerifiedBenchDetail(benchId, await getCurrentUser());
}

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  return searchMapPlaces(query);
}
