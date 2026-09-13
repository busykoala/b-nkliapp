export type PanoramaStatus = "ready" | "generating" | "stale" | "unavailable" | "error";

export type PanoramaDescriptor = {
  status: PanoramaStatus;
  renderKey?: string;
  artifactUrl?: string;
  lightMapUrl?: string;
  generatedAt?: string | null;
  completeness?: "complete" | "partial";
  retryAfterMs?: number;
};
