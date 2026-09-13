import { describe, expect, it } from "vitest";
import { resolvePanoramaArtifactPath } from "./artifact";

describe("panorama artifact boundary", () => {
  it("accepts only WebP artifacts inside the configured cache", () => {
    expect(resolvePanoramaArtifactPath("/cache/renders-v20/ab/file.webp", "/cache"))
      .toBe("/cache/renders-v20/ab/file.webp");
    expect(resolvePanoramaArtifactPath("/other/file.webp", "/cache")).toBeNull();
    expect(resolvePanoramaArtifactPath("/cache/geometry-v4/file.npz", "/cache")).toBeNull();
    expect(resolvePanoramaArtifactPath("/cache/../secret.svg.gz", "/cache")).toBeNull();
  });
});
