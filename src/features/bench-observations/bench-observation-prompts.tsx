"use client";

import { useTranslations } from "next-intl";
import type { Translator } from "@/i18n/types";
import { communityConfidence } from "@/features/bench-detail/components/view-panel";
import { useState } from "react";
import { Check, CloudSun, Eye, RotateCcw, SunDim, SunMedium, Trash2 } from "lucide-react";
import type { BenchObservationSummary, LightObservationChoice } from "@/lib/types";
import {
  deleteOwnObservation,
  submitLightObservation,
  submitViewAgreement,
  undoLightObservation,
} from "./actions";

import { useContributionSave, useContributionWork } from "@/features/bench-community/components/contribution-session";
import { CorrectionForm } from "@/features/bench-community/components/contribution-forms";

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
  const [mine, setMine] = useState(observations.mine);
  const [editing, setEditing] = useState(false);
  const { state, pending, save } = useContributionSave(onChanged);
  const agree = () => save(() => submitViewAgreement(benchId), () => {
    setMine({ kind: "agreement", observedAt: new Date().toISOString() });
  });
  const remove = () => save(() => deleteOwnObservation(benchId, "view"), () => setMine(null));
  return <aside className="observation-prompt is-view" aria-label={t("community.observations.view.label")}>
    <header><Eye size={17} aria-hidden="true" /><div><strong>{t("community.observations.view.title")}</strong><small>{mine ? mine.kind === "agreement" ? t("community.observations.view.agreed") : t("community.observations.view.mine") : t("community.observations.view.intro")}</small></div></header>
    {description && <p className="contribution-view-context"><small>{t("community.workspace.viewDescription")}</small><strong>{description}</strong></p>}
    <div className="observation-choices">
      <button type="button" disabled={pending} aria-pressed={mine?.kind === "agreement"} onClick={agree}><Check size={14} />{t("community.observations.view.agree")}</button>
      <button type="button" disabled={pending} aria-expanded={editing} onClick={() => setEditing(value => !value)}>{t("community.observations.view.edit")}</button>
    </div>
    <div hidden={!editing}><CorrectionForm benchId={benchId} initialField="environment" onChanged={onChanged} /></div>
    <ObservationFootnote message={state?.message ?? null} failed={state?.ok === false} publicText={viewTrendText(observations.publicEstimate, t)} onDelete={mine ? remove : undefined} pending={pending} />
  </aside>;
}

function viewTrendText(estimate: BenchObservationSummary["view"]["publicEstimate"], t: Translator) {
  if (!estimate) return null;
  const parts = [
    estimate.components.openness !== null && estimate.components.openness >= .7 ? t("community.observations.trend.openness") : null,
    estimate.components.naturalness !== null && estimate.components.naturalness >= .7 ? t("community.observations.trend.naturalness") : null,
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
