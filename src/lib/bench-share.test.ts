import { describe, expect, it } from "vitest";
import { canonicalBenchShareUrl } from "./bench-share";

describe("canonicalBenchShareUrl", () => {
  it("shares the selected bench rather than the current map URL", () => {
    expect(canonicalBenchShareUrl("https://bänkliapp.ch/?bank=osm-node-old#map", "osm-node-4998419683"))
      .toBe("https://xn--bnkliapp-0za.ch/?bank=osm-node-4998419683");
  });

  it("encodes community ids safely", () => {
    expect(canonicalBenchShareUrl("http://localhost:3002/statistiken", "community/a b"))
      .toBe("http://localhost:3002/?bank=community%2Fa+b");
  });
});
