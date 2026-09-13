"use server";

import { enqueuePanoramaRequest, readPanoramaDescriptor } from "@/features/bench-panorama/repository";

export async function loadBenchPanorama(benchId: string) {
  return readPanoramaDescriptor(benchId);
}

export async function requestBenchPanorama(benchId: string) {
  return enqueuePanoramaRequest(benchId);
}
