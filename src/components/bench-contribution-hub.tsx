"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, Hammer, HeartHandshake, MessageCircleHeart, Send, Sparkles, Sun, X } from "lucide-react";
import { editBenchMetadata } from "@/app/actions/benches";
import { submitBenchCare, submitBenchMoment } from "@/app/actions/bench-community";
import { LightObservationPrompt, ViewObservationPrompt } from "@/features/bench-observations/bench-observation-prompts";
import { communityTheme } from "@/lib/community-theme";
import type { ActionResult, BenchCareKind, BenchDetail } from "@/lib/types";
import { BenchFeatureEditor } from "./bench-feature-editor";
import { BenchPhotoCapture } from "@/features/bench-photos/photo-capture";
import { BenchCommunityActions } from "./bench-community-actions";
import { CorrectionForm, RatingForm } from "./contribution-forms";

type Refresh = () => void | Promise<void>;

export function BenchContributionHub({ bench, open, onClose, onChanged, initialChapter = "all" }: { initialChapter?: "all" | "rating" | "presence"; bench: BenchDetail; open: boolean; onClose: () => void; onChanged?: Refresh }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const theme = communityTheme();
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return <dialog ref={dialog} onCancel={onClose} onClose={onClose} aria-labelledby={titleId} className="modal modal-bottom sm:modal-middle contribution-dialog">
    <div className="modal-box storybook-sheet contribution-sheet">
      <header className="contribution-sheet-header">
        <div><small>Gemeinsam genauer hinschauen</small><h2 id={titleId}>Zum Bänkli beitragen</h2></div>
        <button type="button" className="btn btn-circle btn-ghost" onClick={onClose} aria-label="Beiträge schliessen"><X size={19} /></button>
      </header>
      <ContributionOverview bench={bench} />
      {initialChapter === "rating" && <ContributionChapter open title="Wie war deine Pause?" summary="Deine Bewertung"><RatingForm benchId={bench.id} rating={bench.myRating} onChanged={onChanged} /></ContributionChapter>}
      {initialChapter === "presence" && <ContributionChapter open title="Bänkli bestätigen" summary="Hast du es vor Ort gesehen?"><BenchCommunityActions bench={bench} signedIn onChanged={onChanged} /></ContributionChapter>}


      <ContributionChapter title="Bänkli beschreiben" summary="Name, Ausstattung und Blickrichtung">
        <MetadataEditor bench={bench} onChanged={onChanged} />
        <BenchFeatureEditor bench={bench} onChanged={onChanged} />
      </ContributionChapter>
      <ContributionChapter title="Licht gerade jetzt" summary={bench.observations.light.mine ? "Deine Beobachtung ist eingetragen" : "Sonne, Schatten oder wechselhaft"}>
        {bench.dayPhase === "night"
          ? <p className="observation-night-note"><Sun size={15} />Diese Frage erscheint bei Tageslicht – dann ist die Beobachtung sinnvoll.</p>
          : <LightObservationPrompt benchId={bench.id} observations={bench.observations.light} onChanged={onChanged} />}
      </ContributionChapter>
      <ContributionChapter title="Aussicht & Umgebung" summary={bench.observations.view.mine ? "Dein Eindruck ist eingetragen" : "Schätzung bestätigen oder anders einordnen"}>
        <ViewObservationPrompt benchId={bench.id} observations={bench.observations.view} onChanged={onChanged} />
      </ContributionChapter>
      <ContributionChapter title="Foto von diesem Platz" summary="Aufnehmen oder aus der Mediathek wählen">
        <BenchPhotoCapture benchId={bench.id} onChanged={onChanged} />
      </ContributionChapter>
      <ContributionChapter title="Einen Moment hinterlassen" summary="Erinnerung, Tipp, Gedicht oder Ortswissen">
        <aside className="community-theme"><Sparkles size={17} aria-hidden="true" /><div><small>Gemeinsames Thema · diesen Monat</small><strong>{theme.title}</strong><p>{theme.prompt}</p></div></aside>
        <MomentForm bench={bench} onChanged={onChanged} />
      </ContributionChapter>
      {initialChapter !== "rating" && <ContributionChapter title="Wie war deine Pause?" summary={bench.myRating ? `Deine Bewertung: ${bench.myRating.overall}/5` : "Komfort, Ruhe und Aussicht bewerten"}>
        <RatingForm benchId={bench.id} rating={bench.myRating} onChanged={onChanged} />
      </ContributionChapter>}
      <ContributionChapter open={initialChapter === "presence"} title="Sich ums Bänkli kümmern" summary={bench.care.mine.length ? `${bench.care.mine.length} heutige ${bench.care.mine.length === 1 ? "Aktion" : "Aktionen"} von dir` : "Kleine, sichtbare Pflegeaktionen"}>
        <CareActions bench={bench} onChanged={onChanged} />
        {initialChapter !== "presence" && <BenchCommunityActions bench={bench} signedIn onChanged={onChanged} />}
      </ContributionChapter>
      <ContributionChapter title="Etwas stimmt nicht" summary="Position, Zustand oder Umgebung melden">
        <CorrectionForm benchId={bench.id} onChanged={onChanged} />
      </ContributionChapter>
    </div>
    <form method="dialog" className="modal-backdrop"><button onClick={onClose}>schliessen</button></form>
  </dialog>;
}

function ContributionOverview({ bench }: { bench: BenchDetail }) {
  const featureCount = bench.properties.filter((item) => item.contributedByMe).length + (bench.directionContributedByMe ? 1 : 0);
  const moments = bench.moments.filter((item) => item.mine).length;
  const entries = [
    featureCount ? `${featureCount} ${featureCount === 1 ? "Angabe" : "Angaben"}` : null,
    bench.observations.light.mine ? "Licht" : null,
    bench.observations.view.mine ? "Aussicht" : null,
    bench.myRating ? "Bewertung" : null,
    moments ? `${moments} ${moments === 1 ? "Moment" : "Momente"}` : null,
  ].filter(Boolean);
  return <div className="contribution-overview"><Check size={17} aria-hidden="true" /><p>{entries.length ? <>Von dir hier: <strong>{entries.join(" · ")}</strong></> : "Hier ist noch kein Beitrag von dir – wähle einfach, was du gerade sicher weisst."}</p></div>;
}

function ContributionChapter({ title, summary, open, children }: { title: string; summary: string; open?: boolean; children: React.ReactNode }) {
  return <details className="contribution-chapter" open={open}><summary><span><strong>{title}</strong><small>{summary}</small></span><span aria-hidden="true">⌄</span></summary><div>{children}</div></details>;
}

function MetadataEditor({ bench, onChanged }: { bench: BenchDetail; onChanged?: Refresh }) {
  const save = async (_previous: ActionResult | null, formData: FormData) => {
    const result = await editBenchMetadata(bench.id, null, formData);
    if (result.ok && onChanged) await onChanged();
    return result;
  };
  const [state, action, pending] = useActionState(save, null);
  return <form action={action} className="contribution-metadata-form">
    <label><span>Name <small>(optional)</small></span><input name="name" maxLength={80} defaultValue={bench.name ?? ""} placeholder="Wie heisst dieses Bänkli?" /></label>
    <label><span>Widmung <small>(was auf der Bank steht)</small></span><textarea name="dedication" maxLength={180} defaultValue={bench.dedication ?? ""} /></label>
    <button disabled={pending}>{pending ? <span className="loading loading-spinner loading-xs" /> : <Check size={15} />} Angaben speichern</button>
    {state && <p role="status" className={state.ok ? "is-success" : "is-error"}>{state.message}</p>}
  </form>;
}

const momentKinds = [
  ["memory", "Erinnerung"], ["recommendation", "Empfehlung"], ["poem", "Gedicht"], ["local_fact", "Ortswissen"],
] as const;

function MomentForm({ bench, onChanged }: { bench: BenchDetail; onChanged?: Refresh }) {
  const [kind, setKind] = useState<(typeof momentKinds)[number][0]>("memory");
  const save = async (_previous: ActionResult | null, formData: FormData) => {
    const result = await submitBenchMoment(bench.id, null, formData);
    if (result.ok && onChanged) await onChanged();
    return result;
  };
  const [state, action, pending] = useActionState(save, null);
  return <form action={action} className="moment-form">
    <fieldset><legend>Was möchtest du teilen?</legend><div>{momentKinds.map(([value, label]) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}</div></fieldset>
    <input type="hidden" name="kind" value={kind} />
    <label><span>Dein Bänkli-Moment</span><textarea required name="body" minLength={2} maxLength={500} placeholder={kind === "poem" ? "Ein paar Zeilen für diesen Platz …" : "Was sollten andere über diesen Platz wissen?"} /></label>
    <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
    <button disabled={pending}>{pending ? <span className="loading loading-spinner loading-xs" /> : <Send size={15} />} Moment veröffentlichen</button>
    {state && <p role="status" className={state.ok ? "is-success" : "is-error"}>{state.message}</p>}
  </form>;
}

const careActions: Array<[BenchCareKind, string, React.ReactNode]> = [
  ["cleaned", "Kurz gereinigt", <Sparkles key="cleaned" />],
  ["good", "In gutem Zustand", <Check key="good" />],
  ["repair", "Braucht Reparatur", <Hammer key="repair" />],
  ["beautiful", "Heute besonders schön", <MessageCircleHeart key="beautiful" />],
];

function CareActions({ bench, onChanged }: { bench: BenchDetail; onChanged?: Refresh }) {
  const [mine, setMine] = useState(new Set(bench.care.mine));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = (kind: BenchCareKind) => startTransition(async () => {
    const result = await submitBenchCare(bench.id, kind);
    setMessage(result.message);
    if (!result.ok) return;
    setMine((current) => new Set(current).add(kind));
    if (onChanged) await onChanged();
  });
  return <div className="care-actions"><p><HeartHandshake size={17} /> Keine Punkte, keine Rangliste – einfach ein Zeichen, dass jemand geschaut hat.</p><div>{careActions.map(([kind, label, icon]) => <button type="button" key={kind} disabled={pending || mine.has(kind)} onClick={() => submit(kind)}>{icon}<span>{mine.has(kind) ? `${label} · von dir` : label}</span></button>)}</div>{message && <p role="status">{message}</p>}</div>;
}
