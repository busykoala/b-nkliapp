import type { WalkPath } from "@/lib/walking";
import type { MessageKey, Translator } from "./types";

// GraphHopper's stable instruction signs; names and destinations are source data.
// https://github.com/graphhopper/graphhopper/blob/master/web-api/src/main/java/com/graphhopper/util/Instruction.java
const turnKeys: Record<number, MessageKey> = {
  [-98]: "routing.instructions.uTurn", [-8]: "routing.instructions.uTurn",
  [-7]: "routing.instructions.keepLeft", [-6]: "routing.instructions.roundaboutExit",
  [-3]: "routing.instructions.sharpLeft", [-2]: "routing.instructions.left", [-1]: "routing.instructions.slightLeft",
  0: "routing.instructions.continue", 1: "routing.instructions.slightRight", 2: "routing.instructions.right",
  3: "routing.instructions.sharpRight", 4: "routing.instructions.arrive", 5: "routing.instructions.via",
  7: "routing.instructions.keepRight", 8: "routing.instructions.uTurn", 9: "routing.instructions.ferry",
};

export function routeInstruction(step: WalkPath["instructions"][number], t: Translator) {
  let instruction = step.sign === 6
    ? step.exit_number && step.exit_number > 0
      ? t("routing.instructions.roundaboutNumber", {exit: step.exit_number})
      : t("routing.instructions.roundaboutEnter")
    : t(turnKeys[step.sign ?? -99] ?? "routing.instructions.unknown");
  const street = step.street_name || step.street_ref;
  if (street && step.sign !== 4 && step.sign !== 5) instruction = t("routing.instructions.street", {instruction, street});
  if (step.ferry === "leave_ferry") instruction = t("routing.instructions.leaveFerry", {instruction});
  const destination = [step.street_destination_ref, step.street_destination].filter(Boolean).join(" · ");
  if (destination) instruction = t("routing.instructions.towards", {instruction, destination});
  return instruction;
}
