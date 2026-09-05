import { describe, expect, it } from "vitest";
import { assessTransfer, summarizeJourney, type JourneyLeg } from "@/lib/journey";
import { journeyBounds, parsePreferences, tightestTransfer } from "./planner-model";

const from = { label: "Spiez", longitude: 7.68, latitude: 46.68 };
const to = { label: "Hafen", longitude: 7.69, latitude: 46.69 };
const leg: JourneyLeg = {
  id: "walk", mode: "walk", from, to, departure: "2026-09-05T08:00:00Z",
  arrival: "2026-09-05T08:10:00Z", durationSeconds: 600, predicted: false,
  geometry: [[7.68, 46.68], [7.7, 46.7], [7.69, 46.69]], geometryQuality: "routed", warnings: [],
};

describe("journey preferences", () => {
  it.each([null, "{", "null", "[]", '"text"', '{"speed":"3","buffer":99}'])("defaults invalid preferences: %s", (raw) => {
    expect(parsePreferences(raw)).toEqual({ speed: 4.2, buffer: 3 });
  });

  it("accepts zero buffer and validates each preference independently", () => {
    expect(parsePreferences('{"speed":5.4,"buffer":0}')).toEqual({ speed: 5.4, buffer: 0 });
    expect(parsePreferences('{"speed":2,"buffer":6}')).toEqual({ speed: 4.2, buffer: 6 });
  });
});

describe("journey map bounds", () => {
  it("includes intermediate geometry without changing the route", () => {
    const original = structuredClone(leg);
    expect(journeyBounds([leg])).toEqual([[7.68, 46.68], [7.7, 46.7]]);
    expect(leg).toEqual(original);
  });

  it("focuses known endpoints when paths are missing without inventing geometry", () => {
    const missing = { ...leg, geometry: [] };
    expect(journeyBounds([missing])).toEqual([[7.68, 46.68], [7.69, 46.69]]);
    expect(missing.geometry).toEqual([]);
    expect(journeyBounds([])).toBeNull();
  });

  it("handles long walking geometries without spreading them onto the stack", () => {
    const geometry: [number, number][] = Array.from({ length: 150_000 }, () => [7.68, 46.68]);
    expect(journeyBounds([{ ...leg, geometry }])).toEqual([[7.68, 46.68], [7.68, 46.68]]);
  });
});

describe("journey transfer summaries", () => {
  it("does not claim a safe transfer when evidence is missing", () => {
    expect(tightestTransfer(summarizeJourney("direct", [leg]))).toBe("Ohne Umsteigen");
    const transfer = assessTransfer(600, null, null, 3);
    expect(tightestTransfer(summarizeJourney("unknown", [{ ...leg, transfer }]))).toBe("Umstiegszeit noch unsicher");
  });

  it("reports the smallest breathing room separately from the requested buffer", () => {
    const option = summarizeJourney("changes", [
      { ...leg, transfer: assessTransfer(900, 120, null, 3) },
      { ...leg, id: "second", transfer: assessTransfer(300, 180, null, 3) },
    ]);
    expect(tightestTransfer(option)).toBe("Engster Umstieg: 2 min Luft · gewünscht +3 min");
  });
});
