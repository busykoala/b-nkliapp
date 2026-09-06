import type { BenchObservationSummary, LightObservationChoice, ViewObservationChoice } from "@/lib/types";

export type LightEvidence = {
  userId: number;
  choice: LightObservationChoice;
  observedAt: string;
};

export type ViewEvidence = {
  userId: number;
  kind: "agreement" | "correction";
  observedAt: string;
  values: ViewObservationChoice | null;
};

export type ObjectiveView = {
  openness: number | null;
  sky: number | null;
  relief: number | null;
  water: number | null;
  naturalness: number | null;
  remoteness: number | null;
};

const componentWeights = {
  openness: 8,
  sky: 8,
  relief: 10,
  water: 8,
  naturalness: 4,
  remoteness: 4,
} as const;

function latestByUser<T extends { userId: number; observedAt: string }>(rows: T[]): T[] {
  const latest = new Map<number, T>();
  for (const row of rows) {
    const current = latest.get(row.userId);
    if (!current || current.observedAt < row.observedAt) latest.set(row.userId, row);
  }
  return [...latest.values()];
}

export function lightTrend(rows: LightEvidence[]): BenchObservationSummary["light"]["publicTrend"] {
  const evidence = latestByUser(rows);
  if (evidence.length < 3) return null;
  const counts: Record<LightObservationChoice, number> = { sun: .75, shade: .75, mixed: .75 };
  for (const row of evidence) counts[row.choice] += 1;
  const total = counts.sun + counts.shade + counts.mixed;
  const shares = { sun: counts.sun / total, shade: counts.shade / total, mixed: counts.mixed / total };
  const choice = (Object.entries(shares) as Array<[LightObservationChoice, number]>)
    .reduce((best, item) => item[1] > best[1] ? item : best)[0];
  return { choice, contributors: evidence.length, shares };
}

function valueFor(row: ViewObservationChoice, key: keyof typeof componentWeights): number {
  if (key === "openness") return ({ wide: .9, partial: .55, enclosed: .2 } as const)[row.openness];
  if (key === "sky") return ({ open: .9, partial: .55, closed: .2 } as const)[row.sky];
  if (key === "relief") return ({ flat: .15, gentle: .5, strong: .9 } as const)[row.relief];
  if (key === "water") return ({ clear: .9, some: .45, none: .05 } as const)[row.water];
  if (key === "naturalness") return ({ natural: .9, mixed: .5, built: .15 } as const)[row.naturalness];
  return ({ quiet: .9, some: .5, strong: .15 } as const)[row.disturbance];
}

export function directionalOpenness(obstructionTypes: string[], directionDegrees: number | null) {
  if (obstructionTypes.length !== 72) return null;
  const indices = obstructionTypes.map((_, index) => index).filter((index) => directionDegrees === null
    || Math.abs((((index * 5 - directionDegrees) + 540) % 360) - 180) <= 45);
  const blocked = indices.filter((index) => obstructionTypes[index] === "building" || obstructionTypes[index] === "vegetation").length;
  return indices.length ? 1 - blocked / indices.length : null;
}

export function scoreViewComponents(components: Pick<ObjectiveView, "sky" | "relief" | "water" | "naturalness" | "remoteness">) {
  if (Object.values(components).some((value) => value === null)) return null;
  return 100 * (.35 * components.sky! + .25 * components.relief! + .15 * components.water!
    + .15 * components.naturalness! + .1 * components.remoteness!);
}

function horizonEvidence(value: ViewObservationChoice["horizon"]) {
  if (value === "open") return { open: .9, trees: .05, buildings: .05 };
  if (value === "trees") return { open: .1, trees: .8, buildings: .1 };
  if (value === "buildings") return { open: .1, trees: .1, buildings: .8 };
  return { open: .34, trees: .33, buildings: .33 };
}

export function blendedViewEstimate(
  rows: ViewEvidence[],
  objective: ObjectiveView,
  objectiveHorizon: { open: number; trees: number; buildings: number },
): BenchObservationSummary["view"]["publicEstimate"] {
  const evidence = latestByUser(rows);
  if (evidence.length < 3) return null;
  const corrections = evidence.filter((row): row is ViewEvidence & { values: ViewObservationChoice } => row.kind === "correction" && row.values !== null);
  const agreements = evidence.length - corrections.length;
  const components = Object.fromEntries(Object.entries(componentWeights).map(([rawKey, priorWeight]) => {
    const key = rawKey as keyof typeof componentWeights;
    const prior = objective[key];
    if (prior === null) {
      if (!corrections.length) return [key, null];
      return [key, corrections.reduce((sum, row) => sum + valueFor(row.values, key), 0) / corrections.length];
    }
    const weighted = prior * (priorWeight + agreements * .25)
      + corrections.reduce((sum, row) => sum + valueFor(row.values, key), 0);
    return [key, weighted / (priorWeight + agreements * .25 + corrections.length)];
  })) as NonNullable<BenchObservationSummary["view"]["publicEstimate"]>["components"];

  const horizonPriorWeight = 8 + agreements * .25;
  const horizons = corrections.map((row) => horizonEvidence(row.values.horizon));
  const horizonTotals = {
    open: objectiveHorizon.open * horizonPriorWeight + horizons.reduce((sum, item) => sum + item.open, 0),
    trees: objectiveHorizon.trees * horizonPriorWeight + horizons.reduce((sum, item) => sum + item.trees, 0),
    buildings: objectiveHorizon.buildings * horizonPriorWeight + horizons.reduce((sum, item) => sum + item.buildings, 0),
  };
  const horizonTotal = horizonTotals.open + horizonTotals.trees + horizonTotals.buildings || 1;
  return {
    contributors: evidence.length,
    components,
    horizon: {
      open: horizonTotals.open / horizonTotal,
      trees: horizonTotals.trees / horizonTotal,
      buildings: horizonTotals.buildings / horizonTotal,
    },
    confidence: Math.min(.9, .35 + evidence.length * .07),
  };
}
