"use client";

import { formatDate } from "@/i18n/date";
import { pointLabel } from "@/i18n/point-label";
import { useFormatter, useTranslations } from "next-intl";

/* eslint-disable @next/next/no-img-element */
import { translateMessage } from "@/i18n/message";
import { routeInstruction } from "@/i18n/route-instructions";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Footprints, X, Sun, Trees, MapPin } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { journeyMinutes, PACE_OPTIONS } from "@/lib/journey";
import { walkCopy } from "@/lib/walks/model";
import { StartPicker } from "../routing/start-picker";
import { useWalkPlanner, walkLegs } from "./use-walk-planner";
import type { ReturnJourney } from "@/lib/journey";

export function WalkPlanner({ getMap, onClose, onReturn }: { getMap: () => MapLibreMap | null; onClose: () => void; onReturn: (journey: ReturnJourney) => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const [expanded, setExpanded] = useState(false); const title = useRef<HTMLHeadingElement>(null);
  const p = useWalkPlanner(getMap), s = p.settings;
  useEffect(() => { title.current?.focus(); }, []);
  const copy = p.chosen && p.result ? walkCopy([p.chosen.bench], p.result.query.shape, p.chosen.extraBenches.length, t) : null;
  return <aside className={`journey-panel storybook-panel ${expanded ? "is-expanded" : ""}`} aria-label={t("walks.planner.title")}>
    <div className="journey-chrome"><button className="overlay-resize" aria-label={t("walks.planner.resize")} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}</button><button aria-label={t("walks.planner.close")} onClick={onClose}><X size={18} /></button></div>
    <div className="journey-scroll"><header><span className="story-eyebrow">{t("walks.planner.eyebrow")}</span><h2 className="programmatic-focus-heading" ref={title} tabIndex={-1}>{t("walks.planner.title")}</h2><p>{t("walks.planner.intro")}</p></header>
      <section className="journey-controls" aria-label={t("walks.planner.label")}>
        <StartPicker origin={p.origin} onChange={p.chooseOrigin} getMap={getMap} />
        <fieldset className="walk-options"><legend>{t("walks.planner.duration")}</legend><div>{([30, 50, 120] as const).map((minutes) => <button key={minutes} aria-pressed={s.minutes === minutes} onClick={() => p.change({ minutes })}>{t("routing.controls.minutes", {minutes})}</button>)}</div></fieldset>
        <details className="journey-adjust"><summary>{t("routing.controls.options")} <small>{s.shape === "loop" ? t("walks.planner.loop") : t("walks.planner.oneWay")} · {format.number(s.speed)} km/h{s.maxRestMinutes ? t("walks.rest.option", {minutes: s.maxRestMinutes}) : ""}</small></summary>
        <fieldset className="walk-options"><legend>{t("walks.planner.route")}</legend><div><button aria-pressed={s.shape === "loop"} onClick={() => p.change({ shape: "loop" })}>{t("walks.planner.loop")}</button><button aria-pressed={s.shape === "one-way"} onClick={() => p.change({ shape: "one-way" })}>{t("walks.planner.oneWay")}</button></div></fieldset>
        <fieldset className="walk-options"><legend>{t("walks.planner.light")}</legend><div><button aria-pressed={s.light === "any"} onClick={() => p.change({ light: "any" })}>{t("routing.controls.any")}</button><button aria-pressed={s.light === "sun"} onClick={() => p.change({ light: "sun" })}><Sun size={18} /> {t("walks.planner.sun")}</button><button aria-pressed={s.light === "shade"} onClick={() => p.change({ light: "shade" })}><Trees size={18} /> {t("walks.planner.shade")}</button></div></fieldset>
          <fieldset className="walk-options"><legend>{t("routing.controls.pace")}</legend><div>{PACE_OPTIONS.map((v) => <button key={v.speed} aria-pressed={s.speed === v.speed} onClick={() => p.change({ speed: v.speed })}>{t(`routing.pace.${v.key}`)}<small>{format.number(v.speed)} km/h</small></button>)}</div></fieldset>
          <div className="journey-time"><label>{t("routing.controls.difficulty")}<select value={s.difficulty} onChange={(e) => p.change({ difficulty: e.target.value as "easy" | "t2" })}><option value="easy">{t("routing.controls.easy")}</option><option value="t2">{t("routing.controls.t2")}</option></select></label><label>{t("routing.controls.time")}<input type="datetime-local" value={s.time} onChange={(e) => p.change({ time: e.target.value })} /></label></div>
          <fieldset className="walk-options rest-options"><legend>{t("walks.rest.legend")}</legend><div>{([undefined, 5, 10, 15] as const).map((minutes) => <button type="button" key={minutes ?? "any"} aria-pressed={s.maxRestMinutes === minutes} onClick={() => p.change({ maxRestMinutes: minutes })}>{minutes ? t("walks.rest.minutes", { minutes }) : t("routing.controls.any")}</button>)}</div><p>{t("walks.rest.explanation")}</p></fieldset>
        </details>
        <button className="journey-submit" disabled={!p.origin || p.pending} onClick={p.submit}><Footprints size={20} />{p.pending ? t("walks.planner.pending") : p.result ? t("walks.planner.update") : t("walks.planner.submit")}</button>
        {p.pending && <p role="status">{t("walks.planner.loading")}</p>}
        {p.dirty && p.result && <p role="status">{t("walks.planner.dirty")}</p>}
        {p.error && <p role="status">{p.error}</p>}
      </section>
      {p.result?.message && <p role="status">{translateMessage(t, p.result.message)}</p>}
      {p.chosen && p.result && copy && <section className="journey-results" aria-label={t("walks.results.title")}>
        {p.result.suggestions.length > 1 && <fieldset className="walk-suggestion-picker"><legend>{t("walks.results.choice", {count: p.result.suggestions.length})}</legend><div>{p.result.suggestions.map((suggestion, index) => {
          const option = walkCopy([suggestion.bench], p.result!.query.shape, suggestion.extraBenches.length, t);
          return <button type="button" key={suggestion.id} aria-pressed={suggestion.id === p.chosen?.id} onClick={() => p.select(suggestion)}><span>{index === 0 ? t("walks.results.recommended") : t("walks.results.variant", {number: index + 1})}</span><strong>{option.title}</strong><small>{t("walks.results.summary", {duration: journeyMinutes(suggestion.durationSeconds), ascent: Math.round(suggestion.path.ascent)})}</small></button>;
        })}</div></fieldset>}
        <div className="journey-recommendation"><span className="story-eyebrow">{t("walks.results.eyebrow")}</span><h2>{copy.title}</h2><p>{t("walks.results.routeSummary", {duration: journeyMinutes(p.chosen.durationSeconds), shape: p.result.query.shape === "loop" ? p.chosen.repeated ? t("walks.planner.outAndBack") : t("walks.planner.loop") : t("walks.planner.oneWay"), ascent: Math.round(p.chosen.path.ascent)})}</p><p>{p.chosen.evidence.reasons.map(reason => translateMessage(t, reason)).join(" · ")}</p><p className="walk-pause">{copy.pause}</p>{copy.discover && <button className="walk-discover" aria-pressed={p.extras} onClick={p.toggleExtras}>{copy.discover}</button>}</div>
        {p.chosen.rest && <section className="walk-rest-summary" aria-label={t("walks.rest.title")}><h3>{t("walks.rest.title")}</h3><p>{t("walks.rest.maximum", {minutes: Math.ceil(p.chosen.rest.maxGapSeconds / 60)})}</p><ol>{p.chosen.rest.stops.map((stop, index) => <li key={`${stop.bench.id}-${index}`}><a href={`/bank/${stop.bench.id}`} target="_blank" rel="noreferrer">{pointLabel(stop.bench, t)}</a><span>{t("walks.rest.after", {minutes: Math.round(stop.routeSeconds / 60)})}</span></li>)}</ol></section>}
        {p.result.query.difficulty === "t2" && <p className="journey-warning">{t("walks.results.t2")}</p>}
        {p.chosen.path.warnings.map((warning, index) => <p className="journey-warning" key={`${warning.key}-${index}`}>{translateMessage(t, warning)}</p>)}
        <ol className="journey-thread"><li><MapPin size={20} /><strong>{pointLabel(p.result.query.origin, t)}</strong><small>{t("walks.results.start")}</small></li>{walkLegs(p.chosen, p.result.query).map((leg, i) => <li key={leg.id}><button className="journey-leg" onClick={() => p.focusLeg(leg)}><span className="journey-stamp">{i === 0 ? <img src="/map-art/markers/bench.webp" width="44" height="44" alt="" /> : <Footprints size={24} />}</span><span><strong>{i === 0 ? copy.pause : t("walks.results.return")}</strong><span>{pointLabel(leg.to, t)}</span></span></button></li>)}</ol>
        <details><summary>{t("routing.controls.directions")}</summary><ol className="walk-instructions">{p.chosen.path.instructions.map((step, i) => <li key={i}>{routeInstruction(step, t)}{step.distance > 0 && <small>{Math.round(step.distance)} m</small>}</li>)}</ol></details>
        <details><summary>{t("walks.results.why")}</summary><p>{t("walks.results.explanation")}</p>{p.chosen.evidence.warnings.map((warning, index) => <p key={`${warning.key}-${index}`}>{translateMessage(t, warning)}</p>)}{p.chosen.evidence.noise?.map((layer) => <p key={`${layer.mode}-${layer.period}`}>{layer.meanDb != null ? t("walks.evidence.noiseCoverage", {mode: t(`knowledge.noise.${layer.mode}`), period: t(`knowledge.noise.${layer.period}`), coverage: Math.round(layer.coverage * 100), value: Math.round(layer.meanDb)}) : `${t(`knowledge.noise.${layer.mode}`)} · ${t(`knowledge.noise.${layer.period}`)}: ${t("knowledge.noise.empty")}`}</p>)}<p>{p.chosen.evidence.updatedAt ? t("walks.results.updated", {date: formatDate(p.chosen.evidence.updatedAt, t)}) : t("walks.results.noData")}  {t("walks.results.extrasNote")}</p></details>
        {p.result.query.shape === "one-way" && <button className="journey-submit" onClick={() => { const journey = p.returnJourney(); if (journey) onReturn(journey); }}>{t("walks.results.planReturn")}</button>}
      </section>}
      <footer className="journey-sources"><details><summary>{t("routing.controls.goodToKnow")}</summary><p>{t("walks.information.estimates")}</p><p>{t("walks.information.privacy")}</p></details></footer>
    </div>
  </aside>;
}
