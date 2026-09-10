import { expect, it } from "vitest";
import { routeInstruction } from "./route-instructions";
import { testTranslator } from "@/test/translations";

it("translates the manoeuvre while retaining street names and route geometry references", () => {
  const step = {sign: -2, street_name: "Lindenhofweg", distance: 45, interval: [2, 5] as [number, number]};
  const original = structuredClone(step);
  expect(routeInstruction(step, testTranslator("de"))).toBe("Links abbiegen · Lindenhofweg");
  expect(routeInstruction(step, testTranslator("fr"))).toBe("Tourner à gauche · Lindenhofweg");
  expect(routeInstruction(step, testTranslator("it"))).toBe("Gira a sinistra · Lindenhofweg");
  expect(routeInstruction(step, testTranslator("rm"))).toBe("Volver a sanestra · Lindenhofweg");
  expect(step).toEqual(original);
});

it("keeps roundabout exit numbers, destination signs and ferry transitions", () => {
  const t = testTranslator("it");
  expect(routeInstruction({sign: 6, exit_number: 3, street_destination: "Spiez", distance: 10, interval: [0, 1]}, t))
    .toBe("Nella rotonda prendi l’uscita 3 · direzione Spiez");
  expect(routeInstruction({sign: 0, ferry: "leave_ferry", distance: 20, interval: [0, 1]}, t))
    .toBe("Scendi dal traghetto · Prosegui dritto");
});

it("does not invent a turn for missing or unknown instruction signs", () => {
  const t = testTranslator("rm");
  for (const sign of [undefined, -99, 999]) expect(routeInstruction({sign, distance: 15, interval: [0, 1]}, t))
    .toBe("Suandar la via inditgada sin la carta");
});
