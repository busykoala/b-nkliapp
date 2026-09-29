import type { ViewObservationChoice } from "@/lib/types";

const choices = {
  openness: ["wide", "partial", "enclosed"], sky: ["open", "partial", "closed"],
  relief: ["flat", "gentle", "strong"], water: ["clear", "some", "none"],
  horizon: ["open", "trees", "buildings", "mixed"], naturalness: ["natural", "mixed", "built"],
  disturbance: ["quiet", "some", "strong"],
} satisfies Record<keyof ViewObservationChoice, readonly string[]>;

/** Do not publish guessed defaults for questions that the visitor never answered. */
export function isCompleteViewDraft(draft: Partial<ViewObservationChoice>): draft is ViewObservationChoice {
  return (Object.keys(choices) as (keyof ViewObservationChoice)[]).every(key => (choices[key] as readonly string[]).includes(draft[key] ?? ""));
}
