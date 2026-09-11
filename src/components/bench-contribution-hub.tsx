"use client";
import { useTranslations } from "next-intl";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { AlertTriangle, Binoculars, Camera, Check, Hammer, HeartHandshake, ImagePlus, ListChecks, MessageCircleHeart, Send, Sparkles, Star, Sun, X } from "lucide-react";
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
  const t = useTranslations();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const theme = communityTheme(t);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return <dialog ref={dialog} onCancel={onClose} onClose={onClose} aria-labelledby={titleId} className="modal modal-bottom sm:modal-middle contribution-dialog">
    <div className="modal-box storybook-sheet contribution-sheet">
      <header className="contribution-sheet-header">
        <div><small>{t("community.hub.eyebrow")}</small><h2 id={titleId}>{t("community.hub.title")}</h2></div>
        <button type="button" className="btn btn-circle btn-ghost" onClick={onClose} aria-label={t("community.hub.close")}><X size={19} /></button>
      </header>
      <ContributionOverview bench={bench} />
      {initialChapter === "rating" && <ContributionChapter open icon={<Star />} title={t("community.chapters.rating.title")} summary={t("community.chapters.rating.summary")}><RatingForm benchId={bench.id} rating={bench.myRating} onChanged={onChanged} /></ContributionChapter>}
      {initialChapter === "presence" && <ContributionChapter open icon={<Check />} title={t("community.chapters.presence.title")} summary={t("community.chapters.presence.summary")}><BenchCommunityActions bench={bench} signedIn onChanged={onChanged} /></ContributionChapter>}

      <ContributionChapter icon={<ListChecks />} title={t("community.chapters.features.title")} summary={t("community.chapters.features.summary")}>
        <MetadataEditor bench={bench} onChanged={onChanged} />
        <BenchFeatureEditor bench={bench} onChanged={onChanged} />
      </ContributionChapter>
      <ContributionChapter icon={<Sun />} title={t("community.chapters.light.title")} summary={bench.observations.light.mine ? t("community.chapters.light.recorded") : t("community.chapters.light.summary")}>
        {bench.dayPhase === "night"
          ? <p className="observation-night-note"><Sun size={15} />{t("community.chapters.light.night")}</p>
          : <LightObservationPrompt benchId={bench.id} observations={bench.observations.light} onChanged={onChanged} />}
      </ContributionChapter>
      <ContributionChapter icon={<Binoculars />} title={t("community.chapters.view.title")} summary={bench.observations.view.mine ? t("community.chapters.view.recorded") : t("community.chapters.view.summary")}>
        <ViewObservationPrompt benchId={bench.id} observations={bench.observations.view} onChanged={onChanged} />
      </ContributionChapter>
      <ContributionChapter icon={<Camera />} title={t("community.chapters.photo.title")} summary={t("community.chapters.photo.summary")}>
        <BenchPhotoCapture benchId={bench.id} onChanged={onChanged} />
      </ContributionChapter>
      <ContributionChapter icon={<ImagePlus />} title={t("community.chapters.moment.title")} summary={t("community.chapters.moment.summary")}>
        <aside className="community-theme"><Sparkles size={17} aria-hidden="true" /><div><small>{t("community.theme.month")}</small><strong>{theme.title}</strong><p>{theme.prompt}</p></div></aside>
        <MomentForm bench={bench} onChanged={onChanged} />
      </ContributionChapter>
      {initialChapter !== "rating" && <ContributionChapter icon={<Star />} title={t("community.chapters.rating.title")} summary={bench.myRating ? t("community.chapters.rating.mine", { rating: bench.myRating.overall }) : t("community.chapters.rating.prompt")}>
        <RatingForm benchId={bench.id} rating={bench.myRating} onChanged={onChanged} />
      </ContributionChapter>}
      <ContributionChapter open={initialChapter === "presence"} icon={<HeartHandshake />} title={t("community.chapters.care.title")} summary={bench.care.mine.length ? t("community.chapters.care.mine", { count: bench.care.mine.length }) : t("community.chapters.care.summary")}>
        <CareActions bench={bench} onChanged={onChanged} />
        {initialChapter !== "presence" && <BenchCommunityActions bench={bench} signedIn onChanged={onChanged} />}
      </ContributionChapter>
      <ContributionChapter icon={<AlertTriangle />} title={t("community.chapters.correction.title")} summary={t("community.chapters.correction.summary")}>
        <CorrectionForm benchId={bench.id} onChanged={onChanged} />
      </ContributionChapter>
    </div>
    <form method="dialog" className="modal-backdrop"><button onClick={onClose}>{t("common.actions.close")}</button></form>
  </dialog>;
}

function ContributionOverview({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const featureCount = bench.properties.filter((item) => item.contributedByMe).length + (bench.directionContributedByMe ? 1 : 0);
  const moments = bench.moments.filter((item) => item.mine).length;
  const entries = [
    featureCount ? t("community.overview.features", { count: featureCount }) : null,
    bench.observations.light.mine ? t("bench.details.light") : null,
    bench.observations.view.mine ? t("bench.details.view") : null,
    bench.myRating ? t("community.overview.rating") : null,
    moments ? t("community.overview.moments", { count: moments }) : null,
  ].filter(Boolean);
  return <div className="contribution-overview"><Check size={17} aria-hidden="true" /><p>{entries.length ? <>{t("community.overview.mine")} <strong>{entries.join(" · ")}</strong></> : t("community.overview.empty")}</p></div>;
}

function ContributionChapter({ title, summary, icon, open, children }: { title: string; summary: string; icon: React.ReactNode; open?: boolean; children: React.ReactNode }) {
  return <details className="contribution-chapter" name="bench-contribution" open={open} onToggle={(event) => {
    const chapter = event.currentTarget;
    if (chapter.open) requestAnimationFrame(() => chapter.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }}><summary><span className="contribution-chapter-icon" aria-hidden="true">{icon}</span><span><strong>{title}</strong><small>{summary}</small></span><span aria-hidden="true">⌄</span></summary><div>{children}</div></details>;
}

function MetadataEditor({ bench, onChanged }: { bench: BenchDetail; onChanged?: Refresh }) {
  const t = useTranslations();
  const save = async (_previous: ActionResult | null, formData: FormData) => {
    const result = await editBenchMetadata(bench.id, null, formData);
    if (result.ok && onChanged) await onChanged();
    return result;
  };
  const [state, action, pending] = useActionState(save, null);
  return <form action={action} className="contribution-metadata-form">
    <label><span>{t("common.fields.name")} <small>{t("common.fields.optional")}</small></span><input name="name" maxLength={80} defaultValue={bench.name ?? ""} placeholder={t("community.metadata.placeholder")} /></label>
    <label><span>{t("submission.fields.dedication")} <small>{t("community.metadata.dedicationHint")}</small></span><textarea name="dedication" maxLength={180} defaultValue={bench.dedication ?? ""} /></label>
    <button disabled={pending}>{pending ? <span className="loading loading-spinner loading-xs" /> : <Check size={15} />}  {t("community.metadata.save")}</button>
    {state && <p role="status" className={state.ok ? "is-success" : "is-error"}>{state.message}</p>}
  </form>;
}

const momentKinds = ["memory", "recommendation", "poem", "local_fact"] as const;

function MomentForm({ bench, onChanged }: { bench: BenchDetail; onChanged?: Refresh }) {
  const t = useTranslations();
  const [kind, setKind] = useState<(typeof momentKinds)[number]>("memory");
  const save = async (_previous: ActionResult | null, formData: FormData) => {
    const result = await submitBenchMoment(bench.id, null, formData);
    if (result.ok && onChanged) await onChanged();
    return result;
  };
  const [state, action, pending] = useActionState(save, null);
  return <form action={action} className="moment-form">
    <fieldset><legend>{t("community.moments.choose")}</legend><div>{momentKinds.map((value) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{t(`community.moments.kinds.${value}`)}</button>)}</div></fieldset>
    <input type="hidden" name="kind" value={kind} />
    <label><span>{t("community.moments.label")}</span><textarea required name="body" minLength={2} maxLength={500} placeholder={kind === "poem" ? t("community.moments.poemPlaceholder") : t("community.moments.placeholder")} /></label>
    <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
    <button disabled={pending}>{pending ? <span className="loading loading-spinner loading-xs" /> : <Send size={15} />}  {t("community.moments.publish")}</button>
    {state && <p role="status" className={state.ok ? "is-success" : "is-error"}>{state.message}</p>}
  </form>;
}

const careActions: Array<[BenchCareKind, React.ReactNode]> = [
  ["cleaned", <Sparkles key="cleaned" />],
  ["good", <Check key="good" />],
  ["repair", <Hammer key="repair" />],
  ["beautiful", <MessageCircleHeart key="beautiful" />],
];

function CareActions({ bench, onChanged }: { bench: BenchDetail; onChanged?: Refresh }) {
  const t = useTranslations();
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
  return <div className="care-actions"><p><HeartHandshake size={17} /> {t("community.care.description")}</p><div>{careActions.map(([kind, icon]) => <button type="button" key={kind} disabled={pending || mine.has(kind)} onClick={() => submit(kind)}>{icon}<span>{mine.has(kind) ? t("community.care.mine", { label: t(`community.care.actions.${kind}`) }) : t(`community.care.actions.${kind}`)}</span></button>)}</div>{message && <p role="status">{message}</p>}</div>;
}
