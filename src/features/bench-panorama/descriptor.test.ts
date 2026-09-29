import { describe, expect, it } from "vitest";
import { retainPanoramaArtifact } from "./descriptor";
import type { PanoramaDescriptor } from "./types";

describe("panorama refreshes", () => {
  const ready: PanoramaDescriptor = { status: "ready", artifactUrl: "/painting-a.webp", materialUrl: "/mask-a.webp" };

  it("accepts the first usable worker render", () => {
    expect(retainPanoramaArtifact({ status: "generating" }, ready)).toBe(ready);
  });

  it("keeps usable artwork through missing and failed refreshes", () => {
    for (const status of ["generating", "stale", "unavailable", "error"] as const) {
      expect(retainPanoramaArtifact(ready, { status, retryAfterMs: 30_000 })).toBe(ready);
    }
  });

  it("updates artwork and optional lighting without retaining obsolete URLs", () => {
    const incoming: PanoramaDescriptor = { status: "ready", artifactUrl: "/painting-b.webp", lightMapUrl: "/light-b.webp" };
    expect(retainPanoramaArtifact(ready, incoming)).toBe(incoming);
  });

  it("still exposes failures when no painting has ever loaded", () => {
    const error: PanoramaDescriptor = { status: "error", retryAfterMs: 30_000 };
    expect(retainPanoramaArtifact({ status: "generating" }, error)).toBe(error);
  });
});
