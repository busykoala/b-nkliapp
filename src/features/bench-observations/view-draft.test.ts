import { describe, expect, it } from "vitest";
import type { ViewObservationChoice } from "@/lib/types";
import { isCompleteViewDraft } from "./view-draft";

const complete: ViewObservationChoice = { openness: "wide", sky: "open", relief: "strong", water: "some", horizon: "trees", naturalness: "natural", disturbance: "quiet" };

describe("view contribution completeness", () => {
  it("does not publish a blank draft or fill in a skipped question", () => {
    expect(isCompleteViewDraft({})).toBe(false);
    for (const key of Object.keys(complete) as (keyof ViewObservationChoice)[]) {
      const draft: Partial<ViewObservationChoice> = { ...complete }; delete draft[key];
      expect(isCompleteViewDraft(draft)).toBe(false);
    }
  });
  it("accepts a deliberately answered view including absence of water", () => {
    expect(isCompleteViewDraft(complete)).toBe(true);
    expect(isCompleteViewDraft({ ...complete, water: "none", sky: "closed" })).toBe(true);
  });
});
