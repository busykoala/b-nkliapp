"use client";

import { formatDate } from "@/i18n/date";
import { pointLabel } from "@/i18n/point-label";
import { useFormatter, useTranslations } from "next-intl";

/* Tiny precompressed map sprites are shared directly with MapLibre. */
/* eslint-disable @next/next/no-img-element */

import { translateMessage } from "@/i18n/message";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Footprints, MapPin, RefreshCw, X } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { JourneyOrigin, JourneyPoint } from "@/lib/journey";
import { StartPicker } from "../routing/start-picker";
import { journeyClock, journeyMinutes, PACE_OPTIONS, type JourneyLeg } from "@/lib/journey";
import { useJourneyPlanner } from "./use-journey-planner";
import { finalWalkingLeg, journeyExternalLinks } from "@/lib/journey-links";
import { tightestTransfer, type JourneySettings } from "@/lib/journey-planner";

export function JourneyPlanner({ bench, initial, getMap, onClose }: { bench: { id: string; title: string }; initial?: { origin: JourneyOrigin; destination: JourneyPoint; time: string }; getMap: () => MapLibreMap | null; onClose: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const [expanded, setExpanded] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const resultSection = useRef<HTMLElement>(null);
  const {
    origin, chooseOrigin,
    settings, updateSettings,
    result, selected, activeLeg, option, error, dirty, pending, submit, selectOption, selectLeg,
  } = useJourneyPlanner(bench.id, getMap, initial);
  const links = option ? journeyExternalLinks(option) : null;
  const finalWalk = option ? finalWalkingLeg(option) : null;
  const { mode, timeMode, time, speed, buffer } = settings;
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => { if (result) resultSection.current?.scrollIntoView({ block: "start", behavior: "instant" }); }, [result]);
  return <aside className={`journey-panel storybook-panel ${expanded ? "is-expanded" : ""}`} aria-label={t("journey.planner.title")}>
    <div className="journey-chrome"><button className="journey-resize" aria-label={t("journey.planner.resize")} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span className="journey-handle" /></button><button aria-label={t("journey.planner.close")} onClick={onClose}><X size={18} /></button></div>
    <div className="journey-scroll">
      <header><span className="story-eyebrow">{t("journey.planner.eyebrow")}</span><h2 tabIndex={-1} ref={title}>{initial ? t("journey.planner.return") : t("journey.planner.title")}</h2><p className="journey-destination"><MapPin size={15} /> {bench.title || t("common.values.bench")}</p></header>
      <section className="journey-controls" aria-label={t("journey.planner.label")}>
        <StartPicker origin={origin} onChange={chooseOrigin} getMap={getMap} />
        <div className="journey-modes">{(["transit", "walk"] as const).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => updateSettings({ mode: m })}>{m === "walk" ? <Footprints size={19} /> : <TransportArt mode="rail" />}{m === "walk" ? t("journey.planner.walk") : t("journey.planner.transit")}</button>)}</div>
        <details className="journey-adjust"><summary>{t("journey.planner.adjust")} <small>{timeMode === "now" ? t("journey.planner.now") : timeMode === "arrival" ? t("journey.planner.arrivalChosen") : t("journey.planner.departureChosen")} · {t(`routing.pace.${PACE_OPTIONS.find((p) => p.speed === speed)?.key ?? "normal"}`)}{mode === "transit" ? t("journey.planner.bufferSummary", {minutes: buffer}) : ""}</small></summary>
        <div className="journey-time"><label>{t("journey.planner.when")}<select value={timeMode} onChange={(e) => updateSettings({ timeMode: e.target.value as JourneySettings["timeMode"] })}><option value="now">{t("journey.planner.leaveNow")}</option><option value="departure">{t("journey.planner.departAt")}</option><option value="arrival">{t("journey.planner.arriveBy")}</option></select></label>{timeMode !== "now" && <label>{t("journey.planner.swissTime")}<input type="datetime-local" value={time} onChange={(e) => updateSettings({ time: e.target.value })} /></label>}</div>
        <fieldset className="journey-pace"><legend>{t("routing.controls.pace")}</legend><div>{PACE_OPTIONS.map((p, i) => <button key={p.speed} aria-pressed={speed === p.speed} onClick={() => updateSettings({ speed: p.speed })}><span className={`pace-drawing pace-${i}`}><Footprints size={24 + i * 3} /></span><strong>{t(`routing.pace.${p.key}`)}</strong><small>{format.number(p.speed)} km/h</small></button>)}</div><small>{t("journey.planner.paceExample", {minutes: Math.ceil(500 / (speed / 3.6) / 60)})}</small></fieldset>
        {mode === "transit" && <fieldset className="journey-buffer"><legend>{t("journey.planner.buffer")}</legend><div>{([0, 3, 6, 10] as const).map((value) => <button key={value} aria-pressed={buffer === value} onClick={() => updateSettings({ buffer: value })}><span>+{value}</span><small>min</small></button>)}</div></fieldset>}
        </details>
        <button className="journey-submit" disabled={pending || !origin} onClick={() => submit()}><RefreshCw size={17} />{pending ? t("journey.planner.pending") : result ? t("journey.planner.update") : t("journey.planner.submit")}</button>
        {pending && <p role="status">{t("journey.planner.loading")}</p>}
        {dirty && result && <p role="status">{t("journey.planner.dirty")}</p>}
        {error && <p role="status">{error}</p>}
      </section>
      {result && <section ref={resultSection} className="journey-results" aria-label={t("journey.results.title")}>
        {result.message && <p role="status">{translateMessage(t, result.message)}</p>}
        {option && <div className="journey-recommendation"><span className="story-eyebrow">{t("journey.results.chosen")}</span><h3>{t("journey.results.arrival", {time: journeyClock(option.arrival)})}</h3><p className="journey-walking-summary"><Footprints size={18} /> {t("journey.results.totalWalking", {duration: journeyMinutes(option.walkingSeconds)})}</p>{finalWalk && <p>{t("journey.results.lastWalk", {duration: finalWalk.geometryQuality === "missing" ? t("journey.results.unknown") : journeyMinutes(finalWalk.durationSeconds)})}{finalWalk.distanceMeters !== undefined ? ` · ${Math.round(finalWalk.distanceMeters)} m` : ""}</p>}<p>{t("journey.results.duration", {duration: journeyMinutes(option.durationSeconds), changes: option.changes})}</p><details><summary>{t("journey.results.transfers")}</summary><p>{tightestTransfer(option, t)}</p></details>{(!option.complete || !option.feasible) && <p className="journey-warning">{t("journey.results.unverified")}</p>}</div>}
        {links && <div className="journey-external-links">{links.sbb && <a href={links.sbb} target="_blank" rel="noreferrer">{t("journey.results.sbb")}</a>}{links.maps && <a href={links.maps} target="_blank" rel="noreferrer">{t("journey.results.maps")}</a>}{links.sbb && <small>{t("journey.results.externalNote")}</small>}</div>}
        {result.options.length > 1 && <details><summary>{t("journey.results.alternatives")}</summary><div className="journey-alternatives">{result.options.filter((o) => o.id !== selected).map((o) => <button key={o.id} onClick={() => selectOption(o)}><strong>{t("journey.results.arrival", {time: journeyClock(o.arrival)})}</strong><span>{t("journey.results.walkingAlternative", {total: journeyMinutes(o.walkingSeconds), last: finalWalkingLeg(o)?.geometryQuality === "missing" ? t("common.values.unknown") : journeyMinutes(finalWalkingLeg(o)?.durationSeconds ?? 0)})}</span><small>{t("journey.results.duration", {duration: journeyMinutes(o.durationSeconds), changes: o.changes})}</small>{(!o.complete || !o.feasible) && <small>{t("journey.results.unverified")}</small>}</button>)}</div></details>}
        {option && <ol className="journey-thread">{option.legs.map((leg) => <li key={leg.id} className={activeLeg === leg.id ? "is-active" : ""}>
          {leg.transfer && <details className={`journey-transfer tone-${leg.transfer.tone}`} onToggle={(e) => { if (e.currentTarget.open) selectLeg(leg, true) }}><summary>{t("journey.transfer.summary", {tone: t(`routing.transfer.tones.${leg.transfer.tone}`)})} <ChevronDown size={16} /></summary><p>{t("journey.transfer.available", {duration: journeyMinutes(leg.transfer.availableSeconds), required: leg.transfer.requiredSeconds === null ? t("journey.transfer.unknown") : t("journey.transfer.required", {duration: journeyMinutes(leg.transfer.requiredSeconds)})})}</p>{leg.transfer.slackSeconds !== null && <p>{t("journey.transfer.slack", {duration: journeyMinutes(leg.transfer.slackSeconds), buffer: leg.transfer.bufferMinutes})}</p>}<p>{t("journey.transfer.calculation", {walking: leg.transfer.walkingSeconds === null ? t("common.values.unknown") : journeyMinutes(leg.transfer.walkingSeconds), minimum: leg.transfer.officialMinimumSeconds === null ? t("journey.transfer.unavailable") : journeyMinutes(leg.transfer.officialMinimumSeconds)})}</p><small>{t(`routing.transfer.evidence.${leg.transfer.evidence}`)}{leg.transfer.guaranteed ? t("journey.transfer.guaranteed") : ""}</small></details>}
          <button className="journey-leg" onClick={() => selectLeg(leg)}><span className="journey-stamp"><TransportArt mode={leg.mode} /></span><span><small>{journeyClock(leg.departure)} · {leg.geometryQuality === "missing" ? t("journey.transfer.unknown") : journeyMinutes(leg.durationSeconds)}</small><strong>{leg.mode === "walk" ? t("journey.leg.walk") : leg.line || t("routing.labels.transit")}</strong><span>{pointLabel(leg.to, t)}</span>{leg.geometryQuality === "schematic" && <small>{t("journey.leg.schematic")}</small>}</span></button>
          <details className="journey-leg-details"><summary>{t("journey.leg.details")}</summary><p>{pointLabel(leg.from, t)}{leg.from.platform ? t("journey.leg.platform", {platform: leg.from.platform}) : ""} → {pointLabel(leg.to, t)}{leg.to.platform ? t("journey.leg.platform", {platform: leg.to.platform}) : ""}</p><p>{journeyClock(leg.departure)}–{journeyClock(leg.arrival)} · {leg.predicted ? t("journey.leg.prediction") : leg.mode === "walk" ? t("journey.leg.estimated") : t("journey.leg.timetable")}{leg.distanceMeters !== undefined ? ` · ${Math.round(leg.distanceMeters)} m` : ""}</p>
          {leg.predicted && <small>{t("journey.leg.scheduled", {departure: journeyClock(leg.scheduledDeparture!), arrival: journeyClock(leg.scheduledArrival!)})}</small>}
          </details>
          {leg.platformChanges?.map((change) => <p className="journey-warning" key={change.key}>{translateMessage(t, change)}</p>)}
          {leg.warnings.map((warning, index) => <p className="journey-warning" key={`${warning.key}-${index}`}>{translateMessage(t, warning)}</p>)}
        </li>)}<li className="journey-arrival"><img src="/map-art/markers/bench.webp" alt="" width="44" height="44" /><strong>{initial ? t("journey.leg.returned") : t("journey.leg.arrived")}</strong></li></ol>}
        <button className="journey-location" disabled={pending} onClick={() => submit(timeMode === "arrival" ? -30 : 30)}>{timeMode === "arrival" ? t("journey.results.earlier") : t("journey.results.later")}</button>
        <small>{t("journey.results.fetched", {time: journeyClock(result.fetchedAt), feed: result.feedUpdatedAt ? t("journey.results.feedDate", {date: formatDate(result.feedUpdatedAt, t)}) : t("journey.results.noFeed")})}</small>
      </section>}
      <footer className="journey-sources"><details><summary>{t("routing.controls.goodToKnow")}</summary><p>{t("journey.information.estimates")}</p><p>{t("journey.information.privacy")}</p><a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">{t("journey.information.mapError")}</a></details></footer>
    </div>
  </aside>;
}
function TransportArt({ mode }: { mode: JourneyLeg["mode"] }) {
  return mode === "walk" ? <Footprints size={26} /> : <img src={`/map-art/transit/${mode}.png`} alt="" width="42" height="42" />;
}
