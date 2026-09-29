"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Moon, X } from "lucide-react";
import { viewLabel } from "@/i18n/bench-labels";
import type { BenchDetail } from "@/lib/types";
import { LightObservationPrompt, ViewObservationPrompt } from "@/features/bench-observations/bench-observation-prompts";
import { BenchPhotoCapture } from "@/features/bench-photos/photo-capture";
import { BenchFeatureEditor } from "./bench-feature-editor";
import { BenchCommunityActions } from "./bench-community-actions";
import { CorrectionForm, RatingForm } from "./contribution-forms";
import { CareActions } from "./contribution-care";
import { MetadataEditor, MomentForm } from "./contribution-writing";
import { ContributionChooser, type ContributionMode, type ContributionTask } from "./contribution-chooser";
import { ContributionSession, type ContributionWork } from "./contribution-session";
import "./contribution-workspace.css";

export type { ContributionMode } from "./contribution-chooser";
type Props = {
  bench: BenchDetail;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
  initialChapter?: ContributionMode;
  onlyFields?: ("backrest" | "armrest" | "covered" | "wheelchair" | "material" | "seats" | "direction")[];
};

/** One top-layer workspace: choose a task, finish it, then return to the same place. */
export function BenchContributionHub({ bench, open, onClose, onChanged, initialChapter = "all", onlyFields }: Props) {
  const t = useTranslations();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const homeScroll = useRef(0);
  const discardReturn = useRef<{ scroll: number; focus: HTMLElement | null } | null>(null);
  const returnTask = useRef<ContributionTask | null>(null);
  const titleId = useId();
  const [active, setActive] = useState<ContributionMode>(initialChapter);
  const [visited, setVisited] = useState<ContributionTask[]>(initialChapter === "all" ? [] : [initialChapter]);
  const [work, setWork] = useState<Record<string, ContributionWork>>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = Object.values(work).some((item) => item.dirty);
  const pending = Object.values(work).some((item) => item.pending);
  const publish = useCallback((id: string, value: ContributionWork | null) => setWork((previous) => {
    if (value && previous[id]?.dirty === value.dirty && previous[id]?.pending === value.pending) return previous;
    const next = { ...previous };
    if (value) next[id] = value; else delete next[id];
    return next;
  }), []);

  // Keep the workspace above the keyboard without undoing pinch zoom.
  useEffect(() => {
    const element = dialog.current;
    const viewport = window.visualViewport;
    if (!element || !viewport) return;
    let frame = 0;
    const update = () => {
      if (Math.abs(viewport.scale - 1) > .01) {
        element.style.removeProperty("--contribution-viewport-height");
        element.style.removeProperty("--contribution-viewport-top");
        delete element.dataset.compactViewport;
        return;
      }
      element.style.setProperty("--contribution-viewport-height", `${viewport.height}px`);
      element.style.setProperty("--contribution-viewport-top", `${viewport.offsetTop}px`);
      element.dataset.compactViewport = String(viewport.height < 460);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
    };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) { element.close(); return; }
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => { element.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [open]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!confirmDiscard && discardReturn.current) {
        const previous = discardReturn.current;
        discardReturn.current = null;
        if (scroller.current) scroller.current.scrollTop = previous.scroll;
        (previous.focus?.isConnected ? previous.focus : heading.current)?.focus({ preventScroll: true });
        return;
      }
      if (scroller.current) scroller.current.scrollTop = active === "all" && !confirmDiscard ? homeScroll.current : 0;
      const choice = active === "all" && !confirmDiscard && returnTask.current
        ? dialog.current?.querySelector<HTMLButtonElement>(`[data-contribution-choice="${returnTask.current}"]`) : null;
      (choice ?? heading.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, confirmDiscard]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);

  const close = () => {
    if (pending) return;
    if (!dirty) { dialog.current?.close(); return; }
    if (!confirmDiscard) discardReturn.current = {
      scroll: scroller.current?.scrollTop ?? 0,
      focus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    setConfirmDiscard(true);
  };
  const choose = (task: ContributionTask) => {
    homeScroll.current = scroller.current?.scrollTop ?? 0;
    returnTask.current = task;
    setVisited((previous) => previous.includes(task) ? previous : [...previous, task]);
    setActive(task);
  };
  const title = confirmDiscard ? t("community.workspace.discardTitle")
    : t(active === "all" ? "community.hub.title" : `community.chapters.${active}.title`);

  return <ContributionSession value={publish}>
    <dialog ref={dialog} aria-labelledby={titleId} className="contribution-dialog" onCancel={(event) => {
      event.preventDefault(); event.stopPropagation();
      if (confirmDiscard) setConfirmDiscard(false); else close();
    }} onClose={(event) => {
      event.stopPropagation();
      // Strict Mode may queue a cleanup close event before reopening this same element.
      if (!dialog.current?.open) onClose();
    }}>
      <div className="contribution-sheet">
        <header className="contribution-sheet-header">
          <div className="contribution-toolbar">
            {active !== "all" && !confirmDiscard ? <button type="button" disabled={pending} onClick={() => setActive("all")}><ArrowLeft size={17} aria-hidden="true" />{t("community.workspace.allTasks")}</button> : <span />}
            <button type="button" disabled={pending} onClick={close} aria-label={t("community.hub.close")}><X size={20} aria-hidden="true" /></button>
          </div>
        </header>
        <div ref={scroller} className="contribution-scroll">
          <div className="contribution-heading">
            <p className="contribution-place">{bench.name || t("common.values.bench")}{bench.locationName && <span> · {bench.locationName}</span>}</p>
            <h2 ref={heading} id={titleId} tabIndex={-1}>{title}</h2>
          </div>
          {confirmDiscard && <div className="contribution-discard">
            <p>{t("community.workspace.discardBody")}</p>
            <button type="button" className="contribution-primary" onClick={() => setConfirmDiscard(false)}>{t("community.workspace.keepEditing")}</button>
            <button type="button" className="contribution-danger" onClick={() => dialog.current?.close()}>{t("community.workspace.discard")}</button>
          </div>}
          <div hidden={active !== "all" || confirmDiscard}><ContributionChooser bench={bench} onChoose={choose} /></div>
          {visited.map((task) => <section key={task} data-contribution-task={task} hidden={active !== task || confirmDiscard}>
            {task === "features" && <><p className="contribution-intro">{t("community.workspace.featureIntro")}</p><BenchFeatureEditor bench={bench} onlyFields={onlyFields} onChanged={onChanged} />{!onlyFields && <MetadataEditor bench={bench} onChanged={onChanged} />}</>}
            {task === "light" && (bench.dayPhase === "night" ? <p className="contribution-night"><Moon size={24} aria-hidden="true" />{t("community.chapters.light.night")}</p> : <LightObservationPrompt benchId={bench.id} observations={bench.observations.light} onChanged={onChanged} />)}
            {task === "view" && <ViewObservationPrompt benchId={bench.id} observations={bench.observations.view} description={bench.viewLabels.filter(label => label !== "Aussicht noch offen").map(label => viewLabel(label, t)).join(" · ")} onChanged={onChanged} />}
            {task === "photo" && <BenchPhotoCapture benchId={bench.id} onChanged={onChanged} />}
            {task === "moment" && <><p className="contribution-intro">{t("community.chapters.moment.summary")}</p><MomentForm bench={bench} onChanged={onChanged} /></>}
            {task === "rating" && <RatingForm benchId={bench.id} rating={bench.myRating} onChanged={onChanged} />}
            {task === "care" && <><p className="contribution-intro">{t("community.workspace.careIntro")}</p><CareActions bench={bench} onChanged={onChanged} /><BenchCommunityActions bench={bench} signedIn onChanged={onChanged} /></>}
            {task === "presence" && <BenchCommunityActions bench={bench} signedIn onChanged={onChanged} />}
            {task === "correction" && <CorrectionForm benchId={bench.id} onChanged={onChanged} />}
          </section>)}
        </div>
        {!confirmDiscard && <footer className="contribution-footer">
          {(active === "all" || pending || dirty) && <small aria-live="polite">{t(pending ? "common.actions.saving" : dirty ? "community.workspace.unsaved" : "community.workspace.oneIsEnough")}</small>}
          <button type="button" disabled={pending} onClick={close}>{t("community.workspace.returnToBench")}</button>
        </footer>}
      </div>
    </dialog>
  </ContributionSession>;
}
