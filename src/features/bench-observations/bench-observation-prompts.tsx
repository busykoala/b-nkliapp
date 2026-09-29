"use client";

import { useTranslations } from "next-intl";
import type { Translator } from "@/i18n/types";
import { communityConfidence } from "@/features/bench-detail/components/view-panel";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CloudSun, Eye, RotateCcw, SunDim, SunMedium, Trash2 } from "lucide-react";
import type { BenchObservationSummary, LightObservationChoice, ViewObservationChoice } from "@/lib/types";
import {
  deleteOwnObservation,
  submitLightObservation,
  submitViewAgreement,
  submitViewObservation,
  undoLightObservation,
} from "./actions";

import { useContributionSave, useContributionWork } from "@/features/bench-community/components/contribution-session";
import { isCompleteViewDraft } from "./view-draft";

const lightChoices: LightObservationChoice[] = ["sun", "shade", "mixed"];
type Refresh = () => void | Promise<void>;

export function LightObservationPrompt({ benchId, observations, onChanged }: {
  benchId: string;
  observations: BenchObservationSummary["light"];
  onChanged?: Refresh;
}) {
  const t = useTranslations();
  const [mine, setMine] = useState(observations.mine);
  const { state, pending, save } = useContributionSave(onChanged);
  useContributionWork(false, pending);
  const choose = (choice: LightObservationChoice) => save(() => submitLightObservation(benchId, choice), () => setMine({ choice, observedAt: new Date().toISOString() }));
  const undo = () => save(() => undoLightObservation(benchId), () => setMine(null));
  return <aside className="observation-prompt" aria-label={t("community.observations.light.label")}>
    <header><SunMedium size={17} aria-hidden="true" /><div><strong>{t("community.observations.light.title")}</strong><small>{mine ? t("community.observations.light.mine", {choice: t(`community.observations.light.choices.${mine.choice}`)}) : t("community.observations.light.intro")}</small></div></header>
    <p className="contribution-save-hint">{t("community.workspace.quickSave")}</p>
    <div className="observation-choices is-light">
      {lightChoices.map((choice) => <button
        type="button" key={choice} disabled={pending} aria-pressed={mine?.choice === choice} onClick={() => choose(choice)}
      >{choice === "sun" ? <SunMedium size={24} aria-hidden="true" /> : choice === "shade" ? <SunDim size={24} aria-hidden="true" /> : <CloudSun size={24} aria-hidden="true" />}{mine?.choice === choice && <Check size={14} aria-hidden="true" />}{t(`community.observations.light.choices.${choice}`)}</button>)}
    </div>
    <ObservationFootnote message={state?.message ?? null} failed={state?.ok === false} publicText={lightTrendText(observations.publicTrend, t)} onUndo={mine ? undo : undefined} pending={pending} />
  </aside>;
}

function lightTrendText(trend: BenchObservationSummary["light"]["publicTrend"], t: Translator) {
  if (!trend) return null;
  return t("community.observations.light.trend", {choice: t(`community.observations.light.choices.${trend.choice}`), count: trend.contributors});
}

export function ViewObservationPrompt({ benchId, observations, onChanged, description }: {
  benchId: string;
  observations: BenchObservationSummary["view"];
  description?: string;
  onChanged?: Refresh;
}) {
  const t = useTranslations();
  const steps = [
  {
    title: t("community.observations.steps.openness"),
    fields: [
      { key: "openness", label: t("community.observations.fields.openness"), choices: [["wide", t("community.observations.choices.openness.wide")], ["partial", t("community.observations.choices.openness.partial")], ["enclosed", t("community.observations.choices.openness.enclosed")]] },
      { key: "sky", label: t("community.observations.fields.sky"), choices: [["open", t("community.observations.choices.sky.open")], ["partial", t("community.observations.choices.sky.partial")], ["closed", t("community.observations.choices.sky.closed")]] },
    ],
  },
  {
    title: t("community.observations.steps.landscape"),
    fields: [
      { key: "relief", label: t("community.observations.fields.relief"), choices: [["flat", t("community.observations.choices.relief.flat")], ["gentle", t("community.observations.choices.relief.gentle")], ["strong", t("community.observations.choices.relief.strong")]] },
      { key: "water", label: t("community.observations.fields.water"), choices: [["clear", t("community.observations.choices.water.clear")], ["some", t("community.observations.choices.water.some")], ["none", t("community.observations.choices.water.none")]] },
    ],
  },
  {
    title: t("community.observations.steps.horizon"),
    fields: [
      { key: "horizon", label: t("community.observations.fields.horizon"), choices: [["open", t("community.observations.choices.horizon.open")], ["trees", t("community.observations.choices.horizon.trees")], ["buildings", t("community.observations.choices.horizon.buildings")], ["mixed", t("community.observations.choices.naturalness.mixed")]] },
    ],
  },
  {
    title: t("community.observations.steps.surroundings"),
    fields: [
      { key: "naturalness", label: t("community.observations.fields.naturalness"), choices: [["natural", t("community.observations.choices.naturalness.natural")], ["mixed", t("community.observations.choices.naturalness.mixed")], ["built", t("community.observations.choices.naturalness.built")]] },
      { key: "disturbance", label: t("community.observations.fields.disturbance"), choices: [["quiet", t("community.observations.choices.disturbance.quiet")], ["some", t("community.observations.choices.disturbance.some")], ["strong", t("community.observations.choices.disturbance.strong")]] },
    ],
  },
] as const;
  const promptRef = useRef<HTMLElement>(null);
  const stepHeadingRef = useRef<HTMLDivElement>(null);
  const [mine, setMine] = useState(observations.mine);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Partial<ViewObservationChoice>>({});
  const { state, pending, save: submit } = useContributionSave(onChanged);
  useContributionWork(editing && Object.keys(draft).length > 0, pending);
  const agree = () => submit(() => submitViewAgreement(benchId), () => {
    setMine({ kind: "agreement", observedAt: new Date().toISOString() });
    setEditing(false); setDraft({});
  });
  const save = () => {
    if (!isCompleteViewDraft(draft)) return;
    const observation = draft;
    submit(() => submitViewObservation(benchId, observation), () => {
      setMine({ kind: "correction", observedAt: new Date().toISOString() });
      setEditing(false); setDraft({}); setStep(0);
    });
  };
  const remove = () => submit(() => deleteOwnObservation(benchId, "view"), () => {
    setMine(null); setEditing(false); setDraft({}); setStep(0);
  });
  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      promptRef.current?.scrollIntoView({ block: "start" });
      stepHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [editing, step]);
  const current = steps[step];
  const answered = current.fields.every(field => draft[field.key] !== undefined);
  return <aside ref={promptRef} className="observation-prompt is-view" aria-label={t("community.observations.view.label")}>
    <header><Eye size={17} aria-hidden="true" /><div><strong>{t("community.observations.view.title")}</strong><small>{mine ? mine.kind === "agreement" ? t("community.observations.view.agreed") : t("community.observations.view.mine") : t("community.observations.view.intro")}</small></div></header>
    {!editing && description && <p className="contribution-view-context"><small>{t("community.workspace.viewDescription")}</small><strong>{description}</strong></p>}
    {!editing && <div className="observation-choices">
      <button type="button" disabled={pending} aria-pressed={mine?.kind === "agreement"} onClick={agree}><Check size={14} />{t("community.observations.view.agree")}</button>
      <button type="button" disabled={pending} aria-expanded={editing} onClick={() => setEditing(true)}>{t("community.observations.view.edit")}</button>
    </div>}
    {editing && <div className="view-observation-editor">
      <p className="contribution-intro">{t("community.workspace.viewIntro")}</p>
      <div ref={stepHeadingRef} className="view-step-heading" tabIndex={-1}><small>{t("community.observations.view.step", {current: step + 1, total: steps.length})}</small><strong>{current.title}</strong></div>
      {current.fields.map((field) => <fieldset key={field.key}>
        <legend>{field.label}</legend>
        <div>{field.choices.map(([value, label]) => <button type="button" key={value} disabled={pending}
          aria-pressed={draft[field.key] === value}
          onClick={() => setDraft((currentDraft) => ({ ...currentDraft, [field.key]: value }))}
        >{draft[field.key] === value && <Check size={13} />}{label}</button>)}</div>
      </fieldset>)}
      <nav aria-label={t("community.observations.view.steps")}>
        <button type="button" disabled={pending} onClick={() => { if (step === 0) { setEditing(false); setDraft({}); } else setStep(step - 1); }}><ChevronLeft size={15} />{step === 0 ? t("common.actions.cancel") : t("community.observations.view.back")}</button>
        {step < steps.length - 1
          ? <button type="button" disabled={pending || !answered} onClick={() => setStep(step + 1)}>{t("community.observations.view.next")}<ChevronRight size={15} /></button>
          : <button type="button" disabled={pending || !isCompleteViewDraft(draft)} onClick={save}><Check size={15} />{t("community.observations.view.save")}</button>}
      </nav>
    </div>}
    <ObservationFootnote message={state?.message ?? null} failed={state?.ok === false} publicText={viewTrendText(observations.publicEstimate, t)} onDelete={mine ? remove : undefined} pending={pending} />
  </aside>;
}

function viewTrendText(estimate: BenchObservationSummary["view"]["publicEstimate"], t: Translator) {
  if (!estimate) return null;
  const parts = [
    estimate.components.openness !== null && estimate.components.openness >= .7 ? t("community.observations.trend.openness") : null,
    estimate.components.naturalness !== null && estimate.components.naturalness >= .7 ? t("community.observations.trend.naturalness") : null,
    estimate.components.remoteness !== null && estimate.components.remoteness >= .7 ? t("community.observations.trend.quiet") : null,
  ].filter(Boolean);
  const confidence = communityConfidence(estimate.confidence, t);
  return t("community.observations.trend.summary", {description: parts.length ? t("community.observations.trend.description", {qualities: parts.join(" · ")}) : t("community.observations.trend.empty"), count: estimate.contributors, confidence});
}

function ObservationFootnote({ message, publicText, onUndo, onDelete, pending, failed = false }: {
  message: string | null;
  failed?: boolean;
  publicText: string | null;
  onUndo?: () => void;
  onDelete?: () => void;
  pending: boolean;
}) {
  const t = useTranslations();
  if (!message && !publicText && !onUndo && !onDelete) return null;
  return <footer>
    <span role={failed ? "alert" : "status"}>{message ?? publicText}</span>
    {onUndo && <button type="button" disabled={pending} onClick={onUndo}><RotateCcw size={13} />{t("community.observations.undo")}</button>}
    {onDelete && <button type="button" disabled={pending} onClick={onDelete}><Trash2 size={13} />{t("common.actions.delete")}</button>}
  </footer>;
}
