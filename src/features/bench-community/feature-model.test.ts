import { describe, expect, it } from "vitest";
import type { BenchProperty } from "@/lib/types";
import { editableBenchFields, editablePropertyValue } from "./feature-model";

const property = (values: Partial<BenchProperty>): BenchProperty => ({ key: "backrest", label: "Rückenlehne", value: "Ja", source: "OpenStreetMap", ...values });

describe("contribution field values", () => {
  it("keeps yes, no and numeric values independent of labels and languages", () => {
    expect(editablePropertyValue(property({ canonicalValue: true, value: "Oui" }))).toBe("yes");
    expect(editablePropertyValue(property({ canonicalValue: false, value: "Nein" }))).toBe("no");
    expect(editablePropertyValue(property({ key: "seats", canonicalValue: 4 }))).toBe("4");
    expect(editablePropertyValue(property({ key: "material", canonicalValue: "wood" }))).toBe("wood");
  });
  it("does not preselect an unknown or conflicting report", () => {
    expect(editablePropertyValue(undefined)).toBeNull();
    expect(editablePropertyValue(property({ canonicalValue: null }))).toBeNull();
    expect(editablePropertyValue(property({ canonicalValue: true, evidenceState: "conflicting" }))).toBeNull();
    expect(editablePropertyValue(property({ evidenceState: "unknown" }))).toBeNull();
  });
  it("supports legacy read models without adding waste bins back to the visitor flow", () => {
    expect(editablePropertyValue(property({ key: "material", value: "Holz" }))).toBe("wood");
    expect(editablePropertyValue(property({ value: "Nein" }))).toBe("no");
    expect(editableBenchFields).not.toContain("wasteBasketNearby");
    expect(new Set(editableBenchFields).size).toBe(editableBenchFields.length);
  });
});
