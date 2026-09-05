import { describe, expect, it } from "vitest";
import { assessTransfer, distanceMeters, swissWallTime, swissWallTimeToIso, walkingSeconds } from "./journey";

describe("journey timing and evidence", () => {
  it("uses chosen walking pace, not a cosmetic duration change", () => {
    expect(walkingSeconds(700, 4.2)).toBe(600);
    expect(walkingSeconds(700, 3)).toBe(840);
    expect(assessTransfer(800, walkingSeconds(700, 3), null, 0).tone).toBe("insufficient");
  });
  it("does not double-count the official minimum and walking time", () => {
    const rule = { type: 2, minimumSeconds: 240, source: "GTFS" };
    expect(assessTransfer(480, 180, rule, 3)).toMatchObject({ requiredSeconds: 240, slackSeconds: 240, tone: "fits" });
    expect(assessTransfer(480, 180, rule, 6).tone).toBe("tight");
    expect(assessTransfer(900, 180, rule, 3).tone).toBe("plenty");
  });
  it("never turns guaranteed transfers or unknown walking times into zero-minute walks", () => {
    expect(assessTransfer(120, 180, { type: 1, minimumSeconds: null, source: "GTFS" }, 0)).toMatchObject({ guaranteed: true, requiredSeconds: 180, tone: "insufficient" });
    expect(assessTransfer(600, null, null, 3).tone).toBe("unknown");
    expect(assessTransfer(600, 0, { type: 3, minimumSeconds: null, source: "GTFS" }, 0).tone).toBe("insufficient");
    expect(assessTransfer(0, null, { type: 4, minimumSeconds: null, source: "exact trip" }, 10)).toMatchObject({ staySeated: true, requiredSeconds: 0, tone: "fits" });
  });
  it("handles Swiss dates independent of browser timezone, rejects spring gaps", () => {
    expect(swissWallTimeToIso("2026-03-29T02:30")).toBeNull();
    expect(swissWallTimeToIso("2026-10-25T02:30")).toBe("2026-10-25T00:30:00.000Z");
    expect(swissWallTime("2026-09-05T22:15:00Z")).toBe("2026-09-06T00:15");
    const available = (Date.parse("2026-09-06T00:06:00+02:00") - Date.parse("2026-09-05T23:58:00+02:00")) / 1000;
    expect(assessTransfer(available, 180, null, 3).slackSeconds).toBe(300);
  });
  it("measures coordinate distances consistently", () => {
    const p = { label: "Spiez", latitude: 46.68844, longitude: 7.68949 };
    expect(distanceMeters(p, p)).toBe(0);
    expect(distanceMeters(p, { ...p, longitude: 7.68989 })).toBeGreaterThan(25);
  });
});
