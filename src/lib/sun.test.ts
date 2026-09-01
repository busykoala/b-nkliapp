import { describe, expect, it } from "vitest";
import { calculateSunState, getLocalSunSchedule, interpolateHorizon } from "./sun";

describe("horizon interpolation", () => {
  it("interpolates across azimuth bins and wraps north", () => {
    const profile = Array.from({ length: 72 }, (_, index) => index);
    expect(interpolateHorizon(profile, 2.5)).toBeCloseTo(0.5);
    expect(interpolateHorizon(profile, 360)).toBe(0);
  });
});

describe("sun obstruction", () => {
  it("never calls a covered bench sunny", () => {
    const state = calculateSunState({ date: new Date("2026-06-21T11:00:00Z"), latitude: 46.9, longitude: 8.2, covered: true, horizonProfile: Array(72).fill(-5) });
    expect(state.sunny).toBe(false);
  });
  it("uses the local horizon", () => {
    const clear = calculateSunState({ date: new Date("2026-06-21T11:00:00Z"), latitude: 46.9, longitude: 8.2, horizonProfile: Array(72).fill(-5) });
    const blocked = calculateSunState({ date: new Date("2026-06-21T11:00:00Z"), latitude: 46.9, longitude: 8.2, horizonProfile: Array(72).fill(89) });
    expect(clear.sunny).toBe(true);
    expect(blocked.sunny).toBe(false);
  });
  it("reports a building as the active obstruction", () => {
    const blocked = calculateSunState({ date: new Date("2026-06-21T11:00:00Z"), latitude: 46.9, longitude: 8.2, horizonProfile: Array(72).fill(89), obstructionTypes: Array(72).fill("building") });
    expect(blocked.shadeCause).toBe("gebäude");
    expect(blocked.altitude).toBeGreaterThan(0);
  });
  it("shortens direct sunshine when the local horizon is high", () => {
    const clear = getLocalSunSchedule({ date: new Date("2026-06-21T12:00:00Z"), latitude: 46.9, longitude: 8.2, horizonProfile: Array(72).fill(0) });
    const blocked = getLocalSunSchedule({ date: new Date("2026-06-21T12:00:00Z"), latitude: 46.9, longitude: 8.2, horizonProfile: Array(72).fill(35) });
    expect(blocked.sunMinutes).toBeLessThan(clear.sunMinutes);
  });
});
