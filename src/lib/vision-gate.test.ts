import { describe, expect, it } from "vitest";
import { visionLabelsEnabled } from "./vision-gate";

describe("vision quality gate", () => {
  it("keeps labels off until an accepted model is recorded", () => {
    expect(visionLabelsEnabled("auto", null)).toBe(false);
    expect(visionLabelsEnabled("auto", '{"recommended":null}')).toBe(false);
    expect(visionLabelsEnabled("auto", "broken")).toBe(false);
  });

  it("enables labels after the benchmark recommends a model", () => {
    expect(visionLabelsEnabled("auto", '{"recommended":"benchly-vision"}')).toBe(true);
    expect(visionLabelsEnabled("true", null)).toBe(true);
    expect(visionLabelsEnabled("false", '{"recommended":"benchly-vision"}')).toBe(false);
  });
});
