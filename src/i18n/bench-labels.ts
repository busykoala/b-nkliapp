import type { BenchProperty } from "@/lib/types";
import type { Translator } from "./types";

export function propertyLabel(property: Pick<BenchProperty, "key">, t: Translator) {
  return t(`bench.attributes.${property.key}`);
}

// Legacy read models contain German display values. Keep these comparisons at
// this boundary; locale changes must never change stored attributes or filters.
const materialKeys = { Holz: "wood", Metall: "metal", Stein: "stone", Beton: "concrete", Kunststoff: "plastic", Gemischt: "mixed", wood: "wood", metal: "metal", stone: "stone", concrete: "concrete", plastic: "plastic", mixed: "mixed" } as const;
export function propertyValue(property: Pick<BenchProperty, "key" | "value">, t: Translator) {
  const { value } = property;
  if (/^unbekannt$/i.test(value)) return t("common.values.unknown");
  if (/^noch offen$/i.test(value)) return t("common.values.open");
  if (value === "Ja") return t("common.values.yes");
  if (value === "Nein") return t("common.values.no");
  if (property.key === "material" && value in materialKeys) return t(`bench.materials.${materialKeys[value as keyof typeof materialKeys]}`);
  return value;
}

const directions = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export function compassDirection(degrees: number, t: Translator) {
  const direction = directions[((Math.round(degrees / 45) % 8) + 8) % 8];
  return `${t(`bench.directions.${direction}`)} · ${Math.round(degrees)}°`;
}

const viewKeys = { Bergblick: "mountains", Hügelblick: "hills", Seeblick: "lake", Wasserblick: "water", Waldblick: "forest", Waldumgebung: "woodland", Weitsicht: "panorama", "Weite Aussicht": "panorama", "Wasser im Umfeld": "nearbyWater", "Eingeschränkte Aussicht": "limited", "Keine besondere Aussicht": "ordinary", "Aussicht noch offen": "unknown" } as const;
export function viewLabel(value: string, t: Translator) {
  return value in viewKeys ? t(`bench.views.${viewKeys[value as keyof typeof viewKeys]}`) : value;
}
