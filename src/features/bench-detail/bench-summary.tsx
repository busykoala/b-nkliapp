"use client";
import { useTranslations } from "next-intl";

import { Armchair, Check, Clock3, Droplets, MapPin, Navigation, Pencil, PersonStanding, Sun, Toilet } from "lucide-react";
import { useState, useTransition } from "react";
import { confirmBench } from "@/app/actions/benches";
import type { Translator } from "@/i18n/types";
import type { BenchDetail } from "@/lib/types";
import { minuteClock } from "./panel-ui";
import { benchFact } from "@/lib/presentation";
import { WeatherSummary } from "@/components/weather-summary";

export function confirmationAge(value: string | null, t: Translator, now = Date.now()) {
  if (!value || !Number.isFinite(Date.parse(value))) return t("bench.summary.unconfirmed");
  const days = Math.max(0, Math.floor((now - Date.parse(value)) / 86_400_000));
  return days === 0 ? t("bench.summary.today") : days === 1 ? t("bench.summary.yesterday") : t("bench.summary.daysAgo", {days});
}

type NearbyAmenity = NonNullable<BenchDetail["knowledge"]>["amenities"][number];

export function BenchSummary({ bench, signedIn, onSignIn, onChanged, onLocateAmenity, amenityMapHrefPrefix, onEditBackrest }: { bench: BenchDetail; signedIn: boolean; onSignIn: () => void; onChanged: () => void | Promise<void>; onLocateAmenity?: (amenity: NearbyAmenity) => void; amenityMapHrefPrefix?: string; onEditBackrest?: () => void }) {
  const t = useTranslations();
  const [localConfirmation, setLocalConfirmation] = useState<string | null>(null);
  const confirmedAt = localConfirmation ?? bench.lastConfirmedAt;
  const mine = Boolean(localConfirmation) || bench.myLastConfirmedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const backrest = benchFact<boolean>(bench, "backrest"), levelSpace = benchFact<boolean>(bench, "wheelchair");
  const light = bench.dayPhase === "night" ? t("bench.summary.night") : bench.sunnyNow === null ? t("bench.summary.unknownLight") : t(bench.sunnyNow ? "bench.summary.sun" : "bench.summary.shade");
  const amenities = (bench.knowledge?.amenities ?? [])
    .filter((item) => ["toilets", "drinking_water"].includes(item.category) && item.distanceMeters !== null)
    .sort((a, b) => a.distanceMeters! - b.distanceMeters!);
  const confirm = () => {
    if (!signedIn) { onSignIn(); return; }
    startTransition(async () => {
      try {
        const result = await confirmBench(bench.id);
        setMessage(result.message);
        if (result.ok) { setLocalConfirmation(new Date().toISOString()); await onChanged(); }
      } catch { setMessage(t("bench.summary.confirmFailed")); }
    });
  };
  return <section className="bench-summary" aria-label={t("bench.summary.title")}>
    <h3>{t("bench.summary.title")}</h3>
    <WeatherSummary weather={bench.weather} dayPhase={bench.dayPhase} />
    <ul className="summary-facts">
      <li><span className="summary-fact-icon"><Armchair size={18} /></span><span><small>{t("bench.details.bench")}</small><strong>{backrest.state === "conflicting" ? t("bench.summary.conflictingBackrest") : backrest.value === true ? t("bench.attributes.backrest") : backrest.value === false ? t("bench.summary.noBackrest") : t("bench.summary.unknownBackrest")}</strong></span>{onEditBackrest && <button type="button" className="summary-fact-edit" aria-label={`${t("community.chapters.features.title")}: ${t("bench.attributes.backrest")}`} onClick={onEditBackrest}><Pencil size={16} /></button>}</li>
      <li title={bench.sunConfidence === "niedrig" ? t("bench.summary.lowConfidence") : t("bench.summary.lightMethod")}><span className="summary-fact-icon"><Sun size={18} /></span><span><small>{t("bench.details.light")}</small><strong>{light}{bench.sunConfidence === "niedrig" && bench.dayPhase !== "night" && bench.sunnyNow !== null ? t("bench.summary.uncertain") : ""}</strong><small className="summary-light-freshness"><Clock3 size={12} aria-hidden="true" />{minuteClock(bench.localMinutesNow)}</small></span></li>
      {levelSpace.state !== "unknown" && <li><span className="summary-fact-icon"><PersonStanding size={18} /></span><span><small>{t("bench.access.atBench")}</small><strong>{levelSpace.state === "conflicting" ? t("bench.summary.conflictingLevelSpace") : levelSpace.value ? t("bench.attributes.wheelchair") : t("bench.summary.noWheelchair")}</strong></span></li>}
    </ul>
    {amenities.length > 0 && <section className="bench-nearby-amenities" aria-labelledby={`nearby-${bench.id}`}>
      <header><div><h4 id={`nearby-${bench.id}`}>{t("bench.summary.nearbyTitle")}</h4><p>{t("bench.summary.nearbyHint")}</p></div><MapPin size={18} /></header>
      <ul>{amenities.map((item) => <AmenityLocation key={item.category} amenity={item} bench={bench} onLocate={onLocateAmenity} href={amenityMapHrefPrefix ? `${amenityMapHrefPrefix}${encodeURIComponent(item.sourceId ?? item.category)}` : undefined} />)}</ul>
    </section>}
    <div className="bench-freshness"><Clock3 size={17} aria-hidden="true" /><span><small>{t("bench.summary.lastSeen")}</small><strong>{confirmationAge(confirmedAt, t)}</strong></span><button type="button" disabled={pending || mine} onClick={confirm}><Check size={16} />{pending ? t("bench.summary.confirming") : mine ? t("bench.summary.mine") : t("community.presence.confirm")}</button></div>
    {message && <p role="status">{message}</p>}
  </section>;
}

function AmenityLocation({ amenity, bench, onLocate, href }: { amenity: NearbyAmenity; bench: BenchDetail; onLocate?: (amenity: NearbyAmenity) => void; href?: string }) {
  const t = useTranslations();
  const label = t(amenity.category === "toilets" ? "knowledge.amenities.toilets" : "knowledge.amenities.drinking_water");
  const Icon = amenity.category === "toilets" ? Toilet : Droplets;
  const located = amenity.latitude !== null && amenity.longitude !== null;
  const direction = located ? bearing(bench.latitude, bench.longitude, amenity.latitude!, amenity.longitude!) : 0;
  const content = <><span className="amenity-icon"><Icon size={18} /></span><span><strong>{label}</strong><small>{t("bench.summary.straightLine", {distance: Math.round(amenity.distanceMeters!)})}</small></span>{located && <span className="amenity-map-cue"><Navigation size={16} style={{transform: `rotate(${direction}deg)`}} />{t("bench.summary.showOnMap")}</span>}</>;
  if (!located) return <li><div className="amenity-location is-static">{content}</div></li>;
  if (onLocate) return <li><button type="button" className="amenity-location" aria-label={t("bench.summary.showFacilityOnMap", {facility: label})} onClick={() => onLocate(amenity)}>{content}</button></li>;
  const locationHref = href ?? `https://www.openstreetmap.org/?mlat=${amenity.latitude}&mlon=${amenity.longitude}#map=19/${amenity.latitude}/${amenity.longitude}`;
  return <li><a className="amenity-location" href={locationHref} target={href ? undefined : "_blank"} rel={href ? undefined : "noreferrer"} aria-label={t("bench.summary.showFacilityOnMap", {facility: label})}>{content}</a></li>;
}

function bearing(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number) {
  const radians = Math.PI / 180;
  const deltaLongitude = (toLongitude - fromLongitude) * radians;
  const from = fromLatitude * radians;
  const to = toLatitude * radians;
  const y = Math.sin(deltaLongitude) * Math.cos(to);
  const x = Math.cos(from) * Math.sin(to) - Math.sin(from) * Math.cos(to) * Math.cos(deltaLongitude);
  return (Math.atan2(y, x) / radians + 360) % 360;
}
