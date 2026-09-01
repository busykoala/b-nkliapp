const cardinalDirections: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

export function parseDirection(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return ((value % 360) + 360) % 360;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized in cardinalDirections) return cardinalDirections[normalized];
  const numeric = Number(normalized.replace("°", ""));
  return Number.isFinite(numeric) ? ((numeric % 360) + 360) % 360 : null;
}

export function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).toLowerCase();
  if (["yes", "true", "1", "designated"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return null;
}

export function scoreView(components: { openness: number; relief: number; water: number; naturalness: number; remoteness: number }) {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return Math.round(100 * (
    0.35 * clamp(components.openness) +
    0.25 * clamp(components.relief) +
    0.15 * clamp(components.water) +
    0.15 * clamp(components.naturalness) +
    0.1 * clamp(components.remoteness)
  ));
}

export function displayMaterial(value: string | null) {
  if (!value) return "Unbekannt";
  const labels: Record<string, string> = { wood: "Holz", metal: "Metall", stone: "Stein", concrete: "Beton", plastic: "Kunststoff" };
  return labels[value.toLowerCase()] ?? value;
}

export function yesNoUnknown(value: number | boolean | null) {
  if (value === null) return "Unbekannt";
  return value ? "Ja" : "Nein";
}
