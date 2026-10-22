import type { PlaceResult } from "@/lib/types";

const key = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-CH");

/** Keep the supplied name intact; omit context already named in an earlier part. */
export function placeLabel(parts: readonly (string | null | undefined)[], separator = " · ") {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const part of parts) {
    if (!part?.trim()) continue;
    const segments = part.split(/[,·]/).map(key).filter(Boolean);
    if (segments.every(segment => seen.has(segment))) continue;
    labels.push(part.trim());
    segments.forEach(segment => seen.add(segment));
  }
  return labels.join(separator);
}

/** A bench and a locality can share a name while offering different actions. */
export function distinctPlaceResults(results: readonly PlaceResult[]) {
  return results.filter((item, index) => results.findIndex(candidate =>
    candidate.kind === item.kind && key(candidate.label) === key(item.label)
  ) === index);
}
