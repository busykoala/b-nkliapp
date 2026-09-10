import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/integrations/weather/repository", () => ({loadWeatherGrid: () => null}));
import { transportRankingScore } from "./evidence";

it("lets recorded railway exposure affect preferences without inventing missing or combined dB values", () => {
  expect(transportRankingScore(1, [35, 64])).toBeCloseTo(.2);
  expect(transportRankingScore(1, [35, undefined])).toBe(1);
  expect(transportRankingScore(.4, [null, undefined])).toBe(.4);
  expect(transportRankingScore(1, [0, 0])).toBe(1);
});
