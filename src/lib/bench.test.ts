import { describe, expect, it } from "vitest";
import { displayMaterial, yesNoUnknown } from "./bench";

describe("bench property labels", () => {
  it("translates known materials and preserves unrecognized descriptions", () => {
    expect(displayMaterial("WOOD")).toBe("Holz");
    expect(displayMaterial("recycled composite")).toBe("recycled composite");
    expect(displayMaterial(null)).toBe("Unbekannt");
  });
  it("keeps missing boolean evidence distinct from no", () => {
    expect(yesNoUnknown(null)).toBe("Unbekannt");
    expect(yesNoUnknown(false)).toBe("Nein");
    expect(yesNoUnknown(0)).toBe("Nein");
    expect(yesNoUnknown(true)).toBe("Ja");
    expect(yesNoUnknown(1)).toBe("Ja");
  });
});
