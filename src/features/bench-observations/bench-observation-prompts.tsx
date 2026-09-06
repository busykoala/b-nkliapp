"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronLeft, ChevronRight, Eye, RotateCcw, SunMedium, Trash2 } from "lucide-react";
import type { BenchObservationSummary, LightObservationChoice, ViewObservationChoice } from "@/lib/types";
import {
  deleteOwnObservation,
  submitLightObservation,
  submitViewAgreement,
  submitViewObservation,
  undoLightObservation,
} from "./actions";

const lightLabels: Record<LightObservationChoice, string> = { sun: "Sonne", shade: "Schatten", mixed: "Wechselhaft" };
type Refresh = () => void | Promise<void>;

export function LightObservationPrompt({ benchId, observations, onChanged }: {
  benchId: string;
  observations: BenchObservationSummary["light"];
  onChanged?: Refresh;
}) {
  const [mine, setMine] = useState(observations.mine);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const choose = (choice: LightObservationChoice) => startTransition(async () => {
    const result = await submitLightObservation(benchId, choice);
    setMessage(result.message);
    if (!result.ok) return;
    setMine({ choice, observedAt: new Date().toISOString() });
    if (onChanged) await onChanged();
  });
  const undo = () => startTransition(async () => {
    const result = await undoLightObservation(benchId);
    setMessage(result.message);
    if (!result.ok) return;
    setMine(null);
    if (onChanged) await onChanged();
  });
  return <aside className="observation-prompt" aria-label="Licht vor Ort melden">
    <header><SunMedium size={17} aria-hidden="true" /><div><strong>Stimmt das gerade?</strong><small>{mine ? `Deine Beobachtung: ${lightLabels[mine.choice]}` : "Ein kurzer Eindruck von vor Ort"}</small></div></header>
    <div className="observation-choices is-light">
      {(Object.keys(lightLabels) as LightObservationChoice[]).map((choice) => <button
        type="button" key={choice} disabled={pending} aria-pressed={mine?.choice === choice} onClick={() => choose(choice)}
      >{mine?.choice === choice && <Check size={14} />}{lightLabels[choice]}</button>)}
    </div>
    <ObservationFootnote message={message} publicText={lightTrendText(observations.publicTrend)} onUndo={mine ? undo : undefined} pending={pending} />
  </aside>;
}

function lightTrendText(trend: BenchObservationSummary["light"]["publicTrend"]) {
  if (!trend) return null;
  return `Community: meist ${lightLabels[trend.choice].toLocaleLowerCase("de-CH")} · ${trend.contributors} Personen`;
}

const initialView: ViewObservationChoice = {
  openness: "partial", sky: "partial", relief: "gentle", water: "none",
  horizon: "mixed", naturalness: "mixed", disturbance: "some",
};

const steps = [
  {
    title: "Wie offen fühlt es sich an?",
    fields: [
      { key: "openness", label: "Freie Sicht", choices: [["wide", "Fast rundum"], ["partial", "Einige Richtungen"], ["enclosed", "Eher eng"]] },
      { key: "sky", label: "Himmel", choices: [["open", "Offen"], ["partial", "Teilweise"], ["closed", "Geschlossen"]] },
    ],
  },
  {
    title: "Was prägt die Landschaft?",
    fields: [
      { key: "relief", label: "Gelände", choices: [["flat", "Flach"], ["gentle", "Sanft"], ["strong", "Starkes Relief"]] },
      { key: "water", label: "Wasser", choices: [["clear", "Klar sichtbar"], ["some", "Etwas sichtbar"], ["none", "Nicht sichtbar"]] },
    ],
  },
  {
    title: "Was steht am Horizont?",
    fields: [
      { key: "horizon", label: "Horizont", choices: [["open", "Überwiegend frei"], ["trees", "Bäume"], ["buildings", "Gebäude"], ["mixed", "Gemischt"]] },
    ],
  },
  {
    title: "Wie wirkt die Umgebung?",
    fields: [
      { key: "naturalness", label: "Umgebung", choices: [["natural", "Natürlich"], ["mixed", "Gemischt"], ["built", "Bebaut"]] },
      { key: "disturbance", label: "Störungen", choices: [["quiet", "Ruhig"], ["some", "Etwas"], ["strong", "Stark"]] },
    ],
  },
] as const;

export function ViewObservationPrompt({ benchId, observations, onChanged }: {
  benchId: string;
  observations: BenchObservationSummary["view"];
  onChanged?: Refresh;
}) {
  const promptRef = useRef<HTMLElement>(null);
  const stepHeadingRef = useRef<HTMLDivElement>(null);
  const [mine, setMine] = useState(observations.mine);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ViewObservationChoice>(initialView);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = async () => { if (onChanged) await onChanged(); };
  const agree = () => startTransition(async () => {
    const result = await submitViewAgreement(benchId);
    setMessage(result.message);
    if (!result.ok) return;
    setMine({ kind: "agreement", observedAt: new Date().toISOString() });
    setEditing(false);
    await changed();
  });
  const save = () => startTransition(async () => {
    const result = await submitViewObservation(benchId, draft);
    setMessage(result.message);
    if (!result.ok) return;
    setMine({ kind: "correction", observedAt: new Date().toISOString() });
    setEditing(false);
    setStep(0);
    await changed();
  });
  const remove = () => startTransition(async () => {
    const result = await deleteOwnObservation(benchId, "view");
    setMessage(result.message);
    if (!result.ok) return;
    setMine(null);
    setEditing(false);
    await changed();
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
  return <aside ref={promptRef} className="observation-prompt is-view" aria-label="Aussicht vor Ort einordnen">
    <header><Eye size={17} aria-hidden="true" /><div><strong>Wie wirkt der Platz für dich?</strong><small>{mine ? mine.kind === "agreement" ? "Von dir ungefähr bestätigt" : "Dein eigener Eindruck ist eingetragen" : "Dein Eindruck hilft, die Schätzung zu verbessern"}</small></div></header>
    {!editing && <div className="observation-choices">
      <button type="button" disabled={pending} aria-pressed={mine?.kind === "agreement"} onClick={agree}><Check size={14} />Passt ungefähr</button>
      <button type="button" disabled={pending} aria-expanded={editing} onClick={() => setEditing(true)}>Anders erlebt</button>
    </div>}
    {editing && <div className="view-observation-editor">
      <div ref={stepHeadingRef} className="view-step-heading" tabIndex={-1}><small>Schritt {step + 1} von {steps.length}</small><strong>{current.title}</strong></div>
      {current.fields.map((field) => <fieldset key={field.key}>
        <legend>{field.label}</legend>
        <div>{field.choices.map(([value, label]) => <button type="button" key={value} disabled={pending}
          aria-pressed={draft[field.key] === value}
          onClick={() => setDraft((currentDraft) => ({ ...currentDraft, [field.key]: value }))}
        >{draft[field.key] === value && <Check size={13} />}{label}</button>)}</div>
      </fieldset>)}
      <nav aria-label="Schritte">
        <button type="button" disabled={pending} onClick={() => step === 0 ? setEditing(false) : setStep(step - 1)}><ChevronLeft size={15} />{step === 0 ? "Abbrechen" : "Zurück"}</button>
        {step < steps.length - 1
          ? <button type="button" disabled={pending} onClick={() => setStep(step + 1)}>Weiter<ChevronRight size={15} /></button>
          : <button type="button" disabled={pending} onClick={save}><Check size={15} />Eintragen</button>}
      </nav>
    </div>}
    <ObservationFootnote message={message} publicText={viewTrendText(observations.publicEstimate)} onDelete={mine ? remove : undefined} pending={pending} />
  </aside>;
}

function viewTrendText(estimate: BenchObservationSummary["view"]["publicEstimate"]) {
  if (!estimate) return null;
  const parts = [
    estimate.components.openness !== null && estimate.components.openness >= .7 ? "eher offen" : null,
    estimate.components.naturalness !== null && estimate.components.naturalness >= .7 ? "natürlich" : null,
    estimate.components.remoteness !== null && estimate.components.remoteness >= .7 ? "ruhig" : null,
  ].filter(Boolean);
  const confidence = estimate.confidence >= .7 ? "gut gestützt" : estimate.confidence >= .5 ? "vorsichtig gestützt" : "erste Tendenz";
  return `Community${parts.length ? `: ${parts.join(" · ")}` : "-Eindruck"} · ${estimate.contributors} Personen · ${confidence}`;
}

function ObservationFootnote({ message, publicText, onUndo, onDelete, pending }: {
  message: string | null;
  publicText: string | null;
  onUndo?: () => void;
  onDelete?: () => void;
  pending: boolean;
}) {
  if (!message && !publicText && !onUndo && !onDelete) return null;
  return <footer>
    <span role="status">{message ?? publicText}</span>
    {onUndo && <button type="button" disabled={pending} onClick={onUndo}><RotateCcw size={13} />Rückgängig</button>}
    {onDelete && <button type="button" disabled={pending} onClick={onDelete}><Trash2 size={13} />Löschen</button>}
  </footer>;
}
