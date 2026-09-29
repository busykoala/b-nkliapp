import type { BenchProperty } from "@/lib/types";

export type EditableBenchField = Exclude<BenchProperty["key"], "wasteBasketNearby"> | "direction";
export const editableBenchFields: EditableBenchField[] = ["backrest", "armrest", "covered", "seats", "wheelchair", "material", "direction", "fireplaceNearby"];

/** Store canonical values, not translated labels, in the editor's draft. */
export function editablePropertyValue(property: BenchProperty | undefined): string | null {
  if (!property || property.evidenceState === "unknown" || property.evidenceState === "conflicting") return null;
  const value = property.canonicalValue;
  if (value === true) return "yes";
  if (value === false) return "no";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (value === null) return null;
  // Older read models still carry German display values. Handle them only here.
  if (property.value === "Ja") return "yes";
  if (property.value === "Nein") return "no";
  const materials: Record<string, string> = { Holz: "wood", Metall: "metal", Stein: "stone", Beton: "concrete", Kunststoff: "plastic", Gemischt: "mixed" };
  if (property.key === "material") return materials[property.value] ?? null;
  if (property.key === "seats" && /^\d+$/.test(property.value)) return property.value;
  return null;
}
