export function displayMaterial(value: string | null) {
  if (!value) return "Unbekannt";
  const labels: Record<string, string> = { wood: "Holz", metal: "Metall", stone: "Stein", concrete: "Beton", plastic: "Kunststoff" };
  return labels[value.toLowerCase()] ?? value;
}

export function yesNoUnknown(value: number | boolean | null) {
  if (value === null) return "Unbekannt";
  return value ? "Ja" : "Nein";
}
