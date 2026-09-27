import { describe, expect, it } from "vitest";
import { weatherIconKind } from "./weather-summary";

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
