import { describe, expect, it } from "vitest";
import { weatherIconKind, resolveWeatherCondition, panoramaCloudCover } from "./conditions";

describe("weather icon semantics", () => {
  it("does not show a sun for clouds at night", () => {
    expect(weatherIconKind("partly-cloudy", true)).toBe("cloud-moon");
    expect(weatherIconKind("cloudy", true)).toBe("cloud-moon");
    expect(weatherIconKind("partly-cloudy", false)).toBe("cloud-sun");
  });

  it("distinguishes unknown and mixed precipitation from ordinary rain", () => {
    expect(weatherIconKind("unknown", false)).toBe("unknown");
    expect(weatherIconKind("mixed", true)).toBe("mixed-precipitation");
    expect(weatherIconKind("rain", true)).toBe("rain");
  });
});

// Missing measurements must not become a factual clear/dry forecast.
it("keeps unknown observation data separate from the art fallback", () => {
  const weather = { cloudCover: null, precipitationType: "unknown" } as Parameters<typeof resolveWeatherCondition>[0];
  expect(resolveWeatherCondition(weather)).toBe("unknown");
  expect(panoramaCloudCover(weather)).toBe(.2);
  expect(resolveWeatherCondition({ ...weather!, precipitationType: "rain" })).toBe("rain");
  expect(panoramaCloudCover({ ...weather!, precipitationType: "rain" })).toBe(.9);
});
