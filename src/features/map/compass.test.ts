import { afterEach, describe, expect, it, vi } from "vitest";
import { compassHeading, headingDelta, waitForCompassHeading } from "./compass";
import { userHeadingFeature } from "./renderer";

function reading(values: object, type = "deviceorientation") {
  return Object.assign(new Event(type), values);
}

describe("map direction", () => {
  it("uses absolute headings, including zero, and accounts for screen rotation", () => {
    expect(compassHeading(reading({ alpha: 0, absolute: true }), 0)).toBe(0);
    expect(compassHeading(reading({ alpha: 270, absolute: true }), 90)).toBe(180);
    expect(compassHeading(reading({ alpha: 270, absolute: false }), 0)).toBeNull();
    expect(compassHeading(reading({ webkitCompassHeading: 0, webkitCompassAccuracy: 10 }), 0)).toBe(0);
    expect(compassHeading(reading({ webkitCompassHeading: 10, webkitCompassAccuracy: -1 }), 0)).toBeNull();
    expect(compassHeading(reading({ alpha: NaN, absolute: true }), 0)).toBeNull();
    expect(headingDelta(359, 1)).toBe(2);
    expect(headingDelta(1, 359)).toBe(-2);
  });
  it("never invents a direction and keeps the cone's apparent size independent of zoom", () => {
    const position = { longitude: 8.54, latitude: 47.37, accuracy: 20 };
    expect(userHeadingFeature(position, null, 15).features).toEqual([]);
    const north = userHeadingFeature(position, 0, 15).features[0].geometry.coordinates[0];
    expect(north[0]).toEqual([position.longitude, position.latitude]);
    expect(north.at(-1)).toEqual(north[0]);
    expect(north[7][0]).toBeCloseTo(position.longitude, 9);
    expect(north[7][1]).toBeGreaterThan(position.latitude);
    const close = userHeadingFeature(position, 0, 16).features[0].geometry.coordinates[0];
    expect((north[7][1] - position.latitude) / (close[7][1] - position.latitude)).toBeCloseTo(2);
  });
});

describe("compass request lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["heading", "abort", "timeout", "already-aborted"] as const)("releases listeners and its deadline on %s", async (outcome) => {
    vi.useFakeTimers();
    const target = Object.assign(new EventTarget(), { screen: { orientation: { angle: 0 } } });
    vi.stubGlobal("window", target);
    const added = vi.spyOn(target, "addEventListener");
    const removed = vi.spyOn(target, "removeEventListener");
    const request = new AbortController();
    const removeAbort = vi.spyOn(request.signal, "removeEventListener");
    if (outcome === "already-aborted") request.abort();
    const result = waitForCompassHeading(request.signal);

    if (outcome === "already-aborted") {
      await expect(result).resolves.toBeNull();
      expect(added).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      return;
    }

    expect(vi.getTimerCount()).toBe(1);
    // Relative device rotation must not satisfy an absolute compass request.
    target.dispatchEvent(reading({ alpha: 270, absolute: false }));
    expect(removed).not.toHaveBeenCalled();
    if (outcome === "heading") target.dispatchEvent(reading({ alpha: 270, absolute: true }));
    else if (outcome === "abort") request.abort();
    else await vi.advanceTimersByTimeAsync(3_000);

    await expect(result).resolves.toBe(outcome === "heading" ? 90 : null);
    expect(removed).toHaveBeenCalledWith("deviceorientationabsolute", expect.any(Function));
    expect(removed).toHaveBeenCalledWith("deviceorientation", expect.any(Function));
    expect(removeAbort).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
