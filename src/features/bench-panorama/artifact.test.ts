import { describe, expect, it } from "vitest";
import { resolvePanoramaArtifactPath } from "./artifact";

describe("panorama artifact boundary", () => {
  it("accepts only WebP artifacts inside the configured cache", () => {
    expect(resolvePanoramaArtifactPath("/cache/active/commit/renders/ab/file.webp", "/cache"))
      .toBe("/cache/active/commit/renders/ab/file.webp");
    expect(resolvePanoramaArtifactPath("/other/file.webp", "/cache")).toBeNull();
    expect(resolvePanoramaArtifactPath("/cache/capsules/file.bpc", "/cache")).toBeNull();
    expect(resolvePanoramaArtifactPath("/cache/../secret.svg.gz", "/cache")).toBeNull();
  });
});
