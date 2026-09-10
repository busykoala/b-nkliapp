import { expect, it } from "vitest";
import { chooseVerificationQuestion, type AttributeKnowledge } from "./model";

const now = Date.parse("2026-09-09T12:00:00Z");
const state = (attribute: string, changes: Partial<AttributeKnowledge> = {}): AttributeKnowledge => ({ attribute, value: 1, confidence: "high", conflicting: false, evidenceCount: 2, sourceTypes: ["community"], latestAt: "2026-09-08", ...changes });
it("asks about missing attributes before recently agreed ones", () => {
  expect(chooseVerificationQuestion([state("backrest")], [], now)?.attribute).toBe("armrest");
});
it("does not repeat a person's recent answer or claim known facts are missing", () => {
  expect(chooseVerificationQuestion([], ["backrest", "armrest", "covered", "approach_steps"], now)).toBeNull();
  expect(chooseVerificationQuestion([state("backrest"), state("armrest"), state("covered"), state("approach_steps")], [], now)).toBeNull();
});
it("prioritizes an unresolved contradiction and retains explicit negative observations", () => {
  expect(chooseVerificationQuestion([state("backrest", { value: 0, conflicting: true })], [], now)).toMatchObject({ attribute: "backrest", reason: "conflicting" });
});
