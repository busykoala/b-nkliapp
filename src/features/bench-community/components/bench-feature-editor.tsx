"use client";
/* eslint-disable @next/next/no-img-element -- repeated panoramic artifact used as an orientation strip */

import { useTranslations } from "next-intl";
import { compassDirection, propertyValue } from "@/i18n/bench-labels";
import { ArrowLeft, Check, ChevronRight, Compass, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { editBenchField } from "@/app/actions/benches";
import type { BenchDetail } from "@/lib/types";
import { editableBenchFields, editablePropertyValue, type EditableBenchField as Field } from "../feature-model";
import { ContributionFeedback, useContributionSave, useContributionWork } from "./contribution-session";

type Choice = { value: string; label: string };

export function BenchFeatureEditor({ bench, onChanged, onlyFields }: { bench: BenchDetail; onlyFields?: Field[]; onChanged?: () => void | Promise<void> }) {
  const t = useTranslations();
  const yesNo: Choice[] = [{ value: "yes", label: t("common.values.yes") }, { value: "no", label: t("common.values.no") }];
  const choices: Record<Field, Choice[]> = {
    backrest: yesNo, armrest: yesNo, covered: yesNo, wheelchair: yesNo, fireplaceNearby: yesNo,
    material: (["wood", "metal", "stone", "concrete", "plastic", "mixed"] as const).map(value => ({ value, label: t(`bench.materials.${value}`) })),
    seats: Array.from({ length: 20 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
    direction: [],
  };
  const [active, setActive] = useState<Field | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<Field, string>>>({});
  const [saved, setSaved] = useState<Partial<Record<Field, string>>>({});
  const root = useRef<HTMLDivElement>(null);
  const returnField = useRef<Field | null>(null);
  const { state, pending, save } = useContributionSave(onChanged);
  useContributionWork(Object.keys(drafts).length > 0, pending);
  useEffect(() => {
    if (pending || (!active && !returnField.current)) return;
    const frame = requestAnimationFrame(() => {
      root.current?.querySelector<HTMLElement>(active ? ".feature-question-title" : `[data-feature="${returnField.current}"]`)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, pending]);
  const fields = editableBenchFields.filter(field => (!onlyFields || onlyFields.includes(field)) && (field === "direction" || bench.properties.some(property => property.key === field)));
  const original = (field: Field) => field === "direction"
    ? (typeof bench.directionDegrees === "number" && Number.isFinite(bench.directionDegrees) ? String((Math.round(bench.directionDegrees) % 360 + 360) % 360) : null)
    : editablePropertyValue(bench.properties.find(property => property.key === field));
  const value = (field: Field) => drafts[field] ?? saved[field] ?? original(field);
  const canSave = (field: Field) => {
    const current = value(field);
    if (current === null) return false;
    return field === "direction" ? Number.isInteger(Number(current)) && Number(current) >= 0 && Number(current) < 360
      : choices[field].some(choice => choice.value === current);
  };
  const label = (field: Field, current: string | null) => field === "direction" && current !== null ? compassDirection(Number(current), t) : choices[field].find(choice => choice.value === current)?.label ?? t("common.values.open");
  const dismiss = () => { returnField.current = active; setActive(null); };
  const commit = (field: Field) => {
    const chosen = value(field);
    if (chosen === null || !canSave(field)) return;
    save(() => editBenchField(bench.id, field, chosen), () => {
      setSaved(previous => ({ ...previous, [field]: chosen }));
      setDrafts(previous => { const next = { ...previous }; delete next[field]; return next; });
      dismiss();
    });
  };
  return <div ref={root} className="contribution-feature-list">
    {active ? <div className="feature-question">
      <button type="button" className="feature-back" disabled={pending} onClick={dismiss}><ArrowLeft size={17} aria-hidden="true" />{t("community.workspace.allFields")}</button>
      <h3 className="feature-question-title" tabIndex={-1}>{t(`community.workspace.questions.${active}`)}</h3>
      {active === "wheelchair" && <p className="contribution-intro">{t("community.workspace.accessHint")}</p>}
      {active === "direction" ? <DirectionFineTuner bench={bench} value={Number(value(active) ?? 0)} pending={pending} onChange={(next) => setDrafts(previous => ({ ...previous, direction: String(next) }))} onSave={() => commit("direction")} canSave={canSave(active)} />
        : <><div className={`field-choice-grid is-${active}`}>{choices[active].map(choice => <button type="button" key={choice.value} disabled={pending} aria-pressed={value(active) === choice.value} onClick={() => setDrafts(previous => ({ ...previous, [active]: choice.value }))}>{value(active) === choice.value && <Check size={15} aria-hidden="true" />}{choice.label}</button>)}</div>
          <button type="button" className="contribution-primary" disabled={pending || !canSave(active)} onClick={() => commit(active)}><Check size={16} aria-hidden="true" />{t(pending ? "common.actions.saving" : "common.actions.save")}</button></>}
      <button type="button" className="feature-skip" disabled={pending} onClick={() => { setDrafts(previous => { const next = { ...previous }; delete next[active]; return next; }); dismiss(); }}>{t("community.workspace.skip")}</button>
    </div> : fields.map(field => {
      const property = bench.properties.find(item => item.key === field);
      const mine = saved[field] !== undefined || (field === "direction" ? bench.directionContributedByMe : property?.contributedByMe);
      const display = saved[field] !== undefined ? label(field, saved[field]!) : property?.evidenceState === "conflicting" ? t("community.workspace.conflicting") : property ? propertyValue(property, t) : label(field, original(field));
      return <section key={field}>
        <button type="button" data-feature={field} disabled={pending} onClick={() => setActive(field)}>
          <span><strong>{t(`bench.attributes.${field}`)}</strong><small>{display}</small></span>
          {drafts[field] !== undefined ? <em>{t("community.workspace.draft")}</em> : mine && <em><Check size={12} aria-hidden="true" />{t("community.features.mine")}</em>}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </section>;
    })}
    <ContributionFeedback state={state} />
  </div>;
}

function DirectionFineTuner({ bench, value, pending, onChange, onSave, canSave }: { bench: BenchDetail; value: number; pending: boolean; canSave: boolean; onChange: (value: number) => void; onSave: () => void }) {
  const t = useTranslations();
  const preview = bench.panorama?.artifactUrl;
  const adjust = (difference: number) => onChange((value + difference + 360) % 360);
  // Mirror the full panorama's projection: each 360° copy is four times the
  // overscanned preview height, with the chosen bearing under the centre line.
  const trackTransform = `translateX(-${43.52 * (1 + value / 360)}rem)`;
  return <div className="direction-fine-tuner">
    <p>{t("bench.directionEditor.intro")}</p>
    <div className={`direction-photo-preview${preview ? " has-image" : ""}`} aria-hidden="true">
      {preview ? <div className="direction-photo-track" style={{ transform: trackTransform }}>{[0, 1, 2].map((copy) => <img key={copy} src={preview} alt="" />)}</div> : <Compass size={54} />}
      <i /><strong>{value}°</strong>
    </div>
    <label><span>{t("bench.directionEditor.slider")}</span><input disabled={pending} type="range" min="0" max="359" step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
    <div className="direction-fine-actions">
      <button type="button" disabled={pending} aria-label={t("bench.directionEditor.minus")} onClick={() => adjust(-5)}><Minus size={16} />5°</button>
      <output>{compassDirection(value, t)}</output>
      <button type="button" disabled={pending} aria-label={t("bench.directionEditor.plus")} onClick={() => adjust(5)}><Plus size={16} />5°</button>
    </div>
    <small>{t(preview ? "bench.directionEditor.imageHint" : "bench.directionEditor.compassHint")}</small>
    <button type="button" className="direction-save" disabled={pending || !canSave} onClick={onSave}><Check size={15} />{pending ? t("common.actions.saving") : t("bench.directionEditor.save")}</button>
  </div>;
}
