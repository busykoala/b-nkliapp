"use client";

import { Check, ChevronDown } from "lucide-react";
import { useState, useTransition } from "react";
import { editBenchField } from "@/app/actions/benches";
import type { BenchDetail, BenchProperty } from "@/lib/types";

type Field = BenchProperty["key"] | "direction";
type Choice = { value: string; label: string; display?: string };

const yesNo: Choice[] = [{ value: "yes", label: "Ja" }, { value: "no", label: "Nein" }];
const choices: Record<Field, Choice[]> = {
  backrest: yesNo,
  armrest: yesNo,
  covered: yesNo,
  wheelchair: yesNo,
  fireplaceNearby: yesNo,
  wasteBasketNearby: yesNo,
  material: [
    { value: "wood", label: "Holz" }, { value: "metal", label: "Metall" }, { value: "stone", label: "Stein" },
    { value: "concrete", label: "Beton" }, { value: "plastic", label: "Kunststoff" }, { value: "mixed", label: "Gemischt" },
  ],
  seats: Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })),
  direction: [
    ["0", "N", "N · 0°"], ["45", "NO", "NO · 45°"], ["90", "O", "O · 90°"], ["135", "SO", "SO · 135°"],
    ["180", "S", "S · 180°"], ["225", "SW", "SW · 225°"], ["270", "W", "W · 270°"], ["315", "NW", "NW · 315°"],
  ].map(([value, label, display]) => ({ value, label, display })),
};

function direction(value: number | null) {
  if (value === null) return "Noch offen";
  return `${["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round(value / 45) % 8]} · ${Math.round(value)}°`;
}

export function BenchFeatureEditor({ bench, onChanged }: { bench: BenchDetail; onChanged?: () => void | Promise<void> }) {
  const [active, setActive] = useState<Field | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries([
    ...bench.properties.map((item) => [item.key, item.value]),
    ["direction", direction(bench.directionDegrees)],
  ]));
  const [mine, setMine] = useState(() => new Set([
    ...bench.properties.filter((item) => item.contributedByMe).map((item) => item.key),
    ...(bench.directionContributedByMe ? ["direction"] : []),
  ]));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fields = [
    ...bench.properties.map((property) => ({ field: property.key as Field, label: property.label })),
    { field: "direction" as const, label: "Blickrichtung" },
  ];
  const choose = (field: Field, choice: Choice) => startTransition(async () => {
    setMessage(null);
    const result = await editBenchField(bench.id, field, choice.value);
    setMessage(result.message);
    if (!result.ok) return;
    setValues((current) => ({ ...current, [field]: choice.display ?? choice.label }));
    setMine((current) => new Set(current).add(field));
    setActive(null);
    if (onChanged) await onChanged();
  });
  return <div className="contribution-feature-list">
    {fields.map(({ field, label }) => <section key={field} className={active === field ? "is-open" : undefined}>
      <button type="button" aria-expanded={active === field} onClick={() => setActive(active === field ? null : field)}>
        <span><small>{label}</small><strong>{values[field] === "Unbekannt" ? "Noch offen" : values[field]}</strong></span>
        {mine.has(field) && <em><Check size={12} /> von dir</em>}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {active === field && <div className={`field-choice-grid is-${field}`}>
        {choices[field].map((choice) => <button type="button" key={choice.value} disabled={pending}
          aria-pressed={values[field] === (choice.display ?? choice.label)} onClick={() => choose(field, choice)}
        >{values[field] === (choice.display ?? choice.label) && <Check size={13} />}{choice.label}</button>)}
      </div>}
    </section>)}
    {message && <p role="status" className="contribution-inline-status">{message}</p>}
  </div>;
}
