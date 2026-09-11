"use client";
import { useFormatter, useTranslations } from "next-intl";

import { Accessibility, Armchair, Check, Droplets, Sun, Toilet, Volume1 } from "lucide-react";
import { useState, useTransition } from "react";
import { confirmBench } from "@/app/actions/benches";
import type { Translator } from "@/i18n/types";
import type { BenchDetail } from "@/lib/types";
import { minuteClock } from "./panel-ui";

export function confirmationAge(value: string | null, t: Translator, now = Date.now()) {
  if (!value || !Number.isFinite(Date.parse(value))) return t("bench.summary.unconfirmed");
  const days = Math.max(0, Math.floor((now - Date.parse(value)) / 86_400_000));
  return days === 0 ? t("bench.summary.today") : days === 1 ? t("bench.summary.yesterday") : t("bench.summary.daysAgo", {days});
}

export function BenchSummary({ bench, signedIn, onSignIn, onChanged }: { bench: BenchDetail; signedIn: boolean; onSignIn: () => void; onChanged: () => void | Promise<void> }) {
  const t = useTranslations();
  const format = useFormatter();
  const [localConfirmation, setLocalConfirmation] = useState<string | null>(null);
  const confirmedAt = localConfirmation ?? bench.lastConfirmedAt;
  const mine = Boolean(localConfirmation) || bench.myLastConfirmedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const property = (key: string) => bench.properties.find((item) => item.key === key)?.value ?? "Unbekannt";
  const backrest = property("backrest"), wheelchair = property("wheelchair");
  const light = bench.dayPhase === "night" ? t("bench.summary.night") : bench.sunnyNow === null ? t("bench.summary.unknownLight") : t(bench.sunnyNow ? "bench.summary.sun" : "bench.summary.shade");
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
    <ul>
      <li><Armchair size={17} /><span>{backrest === "Ja" ? t("bench.attributes.backrest") : backrest === "Nein" ? t("bench.summary.noBackrest") : t("bench.summary.unknownBackrest")}</span></li>
      <li title={bench.sunConfidence === "niedrig" ? t("bench.summary.lowConfidence") : t("bench.summary.lightMethod")}><Sun size={17} /><span>{light}{bench.sunConfidence === "niedrig" && bench.dayPhase !== "night" && bench.sunnyNow !== null ? t("bench.summary.uncertain") : ""}<small className="summary-light-freshness">{t("bench.light.calculatedFor", {time: minuteClock(bench.localMinutesNow)})}</small></span></li>
      <li><Accessibility size={17} /><span>{wheelchair === "Ja" ? t("bench.attributes.wheelchair") : wheelchair === "Nein" ? t("bench.summary.noWheelchair") : t("bench.summary.unknownWheelchair")}</span></li>
      <li><Volume1 size={17} /><span>{bench.ratingBreakdown ? t("bench.summary.quiet", {score: format.number(bench.ratingBreakdown.quiet, {minimumFractionDigits: 1, maximumFractionDigits: 1})}) : t("bench.summary.unknownQuiet")}</span></li>
    </ul>
    {bench.knowledge?.amenities.some((item) => ["toilets", "drinking_water"].includes(item.category) && item.distanceMeters !== null) && <ul className="mt-3">
      {bench.knowledge.amenities.filter((item) => ["toilets", "drinking_water"].includes(item.category) && item.distanceMeters !== null).map((item) => <li key={item.category}>
        {item.category === "toilets" ? <Toilet size={17} /> : <Droplets size={17} />}<span>{t("knowledge.nearby.shortDistance", {facility: t(item.category === "toilets" ? "knowledge.amenities.toilets" : "knowledge.amenities.drinking_water"), distance: Math.round(item.distanceMeters!)})}</span>
      </li>)}
    </ul>}
    <p className="summary-access-note">{t("bench.summary.accessNote")}</p>
    <div className="bench-freshness"><span>{confirmationAge(confirmedAt, t)}</span><button type="button" disabled={pending || mine} onClick={confirm}><Check size={16} />{pending ? t("bench.summary.confirming") : mine ? t("bench.summary.mine") : t("community.presence.confirm")}</button></div>
    {message && <p role="status">{message}</p>}
  </section>;
}
