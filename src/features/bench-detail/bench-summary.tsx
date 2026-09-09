"use client";

import { Accessibility, Armchair, Check, Sun, Volume1 } from "lucide-react";
import { useState, useTransition } from "react";
import { confirmBench } from "@/app/actions/benches";
import type { BenchDetail } from "@/lib/types";

export function confirmationAge(value: string | null, now = Date.now()) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Noch keine Sichtung bestätigt";
  const days = Math.max(0, Math.floor((now - Date.parse(value)) / 86_400_000));
  return days === 0 ? "Heute bestätigt" : days === 1 ? "Gestern bestätigt" : `Bestätigt vor ${days} Tagen`;
}

export function BenchSummary({ bench, signedIn, onSignIn, onChanged }: { bench: BenchDetail; signedIn: boolean; onSignIn: () => void; onChanged: () => void | Promise<void> }) {
  const [localConfirmation, setLocalConfirmation] = useState<string | null>(null);
  const confirmedAt = localConfirmation ?? bench.lastConfirmedAt;
  const mine = Boolean(localConfirmation) || bench.myLastConfirmedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const property = (key: string) => bench.properties.find((item) => item.key === key)?.value ?? "Unbekannt";
  const backrest = property("backrest"), wheelchair = property("wheelchair");
  const light = bench.dayPhase === "night" ? "Nacht" : bench.sunnyNow === null ? "Licht unbekannt" : `${bench.sunnyNow ? "Sonne" : "Schatten"} geschätzt`;
  const confirm = () => {
    if (!signedIn) { onSignIn(); return; }
    startTransition(async () => {
      try {
        const result = await confirmBench(bench.id);
        setMessage(result.message);
        if (result.ok) { setLocalConfirmation(new Date().toISOString()); await onChanged(); }
      } catch { setMessage("Bestätigung konnte nicht gespeichert werden. Bitte erneut versuchen."); }
    });
  };
  return <section className="bench-summary" aria-label="Auf einen Blick">
    <h3>Auf einen Blick</h3>
    <ul>
      <li><Armchair size={17} /><span>{backrest === "Ja" ? "Rückenlehne" : backrest === "Nein" ? "Ohne Rückenlehne" : "Rückenlehne offen"}</span></li>
      <li title={bench.sunConfidence === "niedrig" ? "Geringe Sicherheit der Lichtschätzung" : "Aus Gelände und Umgebung berechnet; Wolken können das Licht ändern"}><Sun size={17} /><span>{light}{bench.sunConfidence === "niedrig" && bench.dayPhase !== "night" && bench.sunnyNow !== null ? " · unsicher" : ""}</span></li>
      <li><Accessibility size={17} /><span>{wheelchair === "Ja" ? "Mit Rollstuhl nutzbar" : wheelchair === "Nein" ? "Mit Rollstuhl nicht nutzbar" : "Rollstuhlnutzung offen"}</span></li>
      <li><Volume1 size={17} /><span>{bench.ratingBreakdown ? `Ruhe ${bench.ratingBreakdown.quiet.toFixed(1)}/5` : "Ruhe unbewertet"}</span></li>
    </ul>
    <p className="summary-access-note">Zugangsweg: nicht auf Rollstuhltauglichkeit geprüft.</p>
    <div className="bench-freshness"><span>{confirmationAge(confirmedAt)}</span><button type="button" disabled={pending || mine} onClick={confirm}><Check size={16} />{pending ? "Wird bestätigt …" : mine ? "Heute von dir bestätigt" : "Ist noch da"}</button></div>
    {message && <p role="status">{message}</p>}
  </section>;
}
