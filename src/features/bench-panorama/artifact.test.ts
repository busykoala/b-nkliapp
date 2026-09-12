import { describe, expect, it } from "vitest";
import { resolvePanoramaArtifactPath } from "./artifact";

describe("panorama artifact boundary", () => {
  it("accepts only gzipped SVG artifacts inside the configured cache", () => {
    expect(resolvePanoramaArtifactPath("/cache/renders/ab/file.svg.gz", "/cache"))
      .toBe("/cache/renders/ab/file.svg.gz");
    expect(resolvePanoramaArtifactPath("/other/file.svg.gz", "/cache")).toBeNull();
    expect(resolvePanoramaArtifactPath("/cache/geometry/file.json.gz", "/cache")).toBeNull();
    expect(resolvePanoramaArtifactPath("/cache/../secret.svg.gz", "/cache")).toBeNull();
  });
});
