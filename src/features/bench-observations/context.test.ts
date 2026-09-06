import { describe, expect, it } from "vitest";
import { benchObservationNow, lightObservationContext, observationSeason } from "./context";

describe("observation context", () => {
  const latitude = 46.68844;
  const longitude = 7.68949;

  it("rejects light observations during astronomical night", () => {
    expect(lightObservationContext(new Date("2026-09-05T22:00:00+02:00"), latitude, longitude)).toBeNull();
  });

  it("maps daylight phases to comparable community buckets", () => {
    expect(lightObservationContext(new Date("2026-09-05T12:00:00+02:00"), latitude, longitude)).toEqual({
      season: "autumn",
      dayPhase: "day",
    });
  });

  it("uses Swiss local dates for seasons", () => {
    expect(observationSeason(new Date("2026-02-28T23:30:00Z"))).toBe("spring");
  });

  it("only accepts a fixed browser-review clock with demo data", () => {
    process.env.BENCHLY_SEED_DEMO = "true";
    process.env.BENCHLY_E2E_NOW = "2026-09-05T12:00:00+02:00";
    expect(benchObservationNow().toISOString()).toBe("2026-09-05T10:00:00.000Z");
    delete process.env.BENCHLY_E2E_NOW;
    delete process.env.BENCHLY_SEED_DEMO;
  });
});
