import type { JourneyOrigin, JourneyPoint } from "../journey";
import type { WalkPath } from "../walking";

export type WalkQuery = { origin: JourneyOrigin; minutes: 30 | 50 | 120; shape: "loop" | "one-way"; light: "any" | "sun" | "shade"; speed: 3 | 4.2 | 5.4; difficulty: "easy" | "t2"; time: string };
export type WalkBench = JourneyPoint & { id: string; name: string | null; waterfront: boolean; quality: number | null };
export type RouteEvidence = { quiet: number | null; nature: number | null; view: number | null; water: number | null; light: number | null; lightCoverage: number; coverage: number; updatedAt: string | null; reasons: string[]; warnings: string[] };
export type WalkSuggestion = { id: string; path: WalkPath; bench: WalkBench; extraBenches: WalkBench[]; durationSeconds: number; score: number; evidence: RouteEvidence; withinBudget: boolean; repeated: boolean; benchIndex: number };
export type WalkResult = { suggestions: WalkSuggestion[]; query: WalkQuery; fetchedAt: string; partial: boolean; message?: string };

export function individualBenchName(name: string | null) { return name && !/^(sitzbank|bank|bänkli|bench)$/i.test(name.trim()) ? name : null; }
export function walkCopy(benches: WalkBench[], shape: WalkQuery["shape"], extraCount: number) {
  const bench = benches[0], name = individualBenchName(bench?.name ?? null);
  const noun = name ? `Bänkli «${name}»` : bench?.waterfront ? "Uferbänkli" : "Bänkli";
  return {
    title: shape === "loop" ? `Eine Runde zum ${noun}` : `Ein Spaziergang zum ${noun}`,
    pause: benches.length > 1 ? `Mit ${benches.length} Bänkli zum Innehalten` : name ? `Mit dem ${noun} zum Innehalten` : bench?.waterfront ? "Mit einem Bänkli am Wasser zum Innehalten" : "Mit einem Bänkli zum Innehalten",
    discover: extraCount === 0 ? null : extraCount === 1 ? "Und unterwegs noch ein weiteres Bänkli zum Entdecken." : `Und unterwegs noch ${extraCount} weitere Bänkli zum Entdecken.`,
  };
}
export function verifiedExtras(candidates: WalkBench[], planned: WalkBench[]) {
  const seen = new Set(planned.map((b) => b.id));
  return candidates.filter((b) => { if (seen.has(b.id)) return false; seen.add(b.id); return true; });
}
export function landscapeScore(e: RouteEvidence, bench: WalkBench, light: WalkQuery["light"]) {
  // Unknown evidence earns no points. Do not renormalize missing terms into a high score.
  const base = .4 * (e.quiet ?? 0) + .2 * (e.nature ?? 0) + .2 * (e.view ?? 0) + .1 * (e.water ?? 0) + .1 * (bench.quality ?? 0);
  return light === "any" ? base : .8 * base + .2 * (e.light ?? 0);
}
