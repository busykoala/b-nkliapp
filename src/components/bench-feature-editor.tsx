"use client";

import { useTranslations } from "next-intl";
import { compassDirection, propertyLabel, propertyValue } from "@/i18n/bench-labels";
import { Check, ChevronDown } from "lucide-react";
import { useState, useTransition } from "react";
import { editBenchField } from "@/app/actions/benches";
import type { BenchDetail, BenchProperty } from "@/lib/types";

type Field = BenchProperty["key"] | "direction";
type Choice = { value: string; label: string; display?: string };

export function BenchFeatureEditor({ bench, onChanged, onlyFields }: { bench: BenchDetail; onlyFields?: Field[]; onChanged?: () => void | Promise<void> }) {
  const t = useTranslations();
  const yesNo: Choice[] = [{value: "yes", label: t("common.values.yes")}, {value: "no", label: t("common.values.no")}];
  const choices: Record<Field, Choice[]> = {
    backrest: yesNo, armrest: yesNo, covered: yesNo, wheelchair: yesNo, fireplaceNearby: yesNo, wasteBasketNearby: yesNo,
    material: (["wood", "metal", "stone", "concrete", "plastic", "mixed"] as const).map(value => ({value, label: t(`bench.materials.${value}`)})),
    seats: Array.from({length: 12}, (_, i) => ({value: String(i + 1), label: String(i + 1)})),
    direction: [0, 45, 90, 135, 180, 225, 270, 315].map(degrees => ({value: String(degrees), label: compassDirection(degrees, t), display: compassDirection(degrees, t)})),
  };
  const [active, setActive] = useState<Field | null>(null);
  const sourceValues: Record<string, string> = Object.fromEntries([
    ...bench.properties.map((item) => [item.key, propertyValue(item, t)]),
    ["direction", bench.directionDegrees === null ? t("common.values.open") : compassDirection(bench.directionDegrees, t)],
  ]);
  const [overrides, setOverrides] = useState<Record<string, { base: string; value: string }>>({});
  const values = Object.fromEntries(Object.entries(sourceValues).map(([field, value]) => [field, overrides[field]?.base === value ? overrides[field].value : value]));
  const [mine, setMine] = useState(() => new Set([
    ...bench.properties.filter((item) => item.contributedByMe).map((item) => item.key),
    ...(bench.directionContributedByMe ? ["direction"] : []),
  ]));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fields = [
    ...bench.properties.map((property) => ({ field: property.key as Field, label: propertyLabel(property, t) })),
    { field: "direction" as const, label: t("bench.attributes.direction") },
  ];
  const unknownValues = new Set([t("common.values.unknown"), t("common.values.open"), ""]);
  const visibleFields = fields
    .filter(({ field }) => !onlyFields || onlyFields.includes(field))
    .sort((left, right) => Number(!unknownValues.has(values[left.field])) - Number(!unknownValues.has(values[right.field])));
  const choose = (field: Field, choice: Choice) => startTransition(async () => {
    setMessage(null);
    const result = await editBenchField(bench.id, field, choice.value);
    setMessage(result.message);
    if (!result.ok) return;
    setOverrides((current) => ({ ...current, [field]: { base: sourceValues[field], value: choice.display ?? choice.label } }));
    setMine((current) => new Set(current).add(field));
    setActive(null);
    if (onChanged) await onChanged();
  });
  const known = Object.values(values).filter((value) => value && value !== t("common.values.unknown") && value !== t("common.values.open")).length;
  return <div className="contribution-feature-list">
    <p className="feature-progress" role="status">{t("community.features.progress", {known, total: fields.length})}</p>
    {visibleFields.map(({ field, label }) => <section key={field} className={active === field ? "is-open" : undefined}>
      <button type="button" aria-expanded={active === field} onClick={() => setActive(active === field ? null : field)}>
        <span><small>{label}</small><strong>{values[field] === t("common.values.unknown") ? t("common.values.open") : values[field]}</strong></span>
        {mine.has(field) && <em><Check size={12} /> {t("community.features.mine")}</em>}
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
