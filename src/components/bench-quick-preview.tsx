"use client";

import { Armchair, Navigation, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { requestBenchPanorama } from "@/app/actions/panorama";
import type { CurrentUser } from "@/lib/security";
import type { BenchDetail } from "@/lib/types";
import { BenchSaveButton } from "./bench-save-button";

export function BenchQuickPreview({ bench, user, onJourney, onChanged }: {
  bench: BenchDetail;
  user: CurrentUser | null;
  onJourney?: () => void;
  onChanged?: () => void | Promise<void>;
}) {
  const t = useTranslations();
  useEffect(() => {
    // Selection prewarms a missing painting while the user can already decide
    // from place and facts. The full detail does not need to mount to request it.
    if (bench.panorama?.status !== "ready") void requestBenchPanorama(bench.id).catch(() => {});
  }, [bench.id, bench.panorama?.status]);
  const backrest = bench.properties.find((item) => item.key === "backrest")?.value;
  const comfort = backrest === "Ja" ? t("bench.attributes.backrest")
    : backrest === "Nein" ? t("bench.summary.noBackrest") : t("bench.summary.unknownBackrest");
  const light = bench.dayPhase === "night" ? t("bench.summary.night")
    : bench.sunnyNow === null ? t("bench.summary.unknownLight")
      : t(bench.sunnyNow ? "bench.summary.sun" : "bench.summary.shade");
  return <section className="bench-quick-preview" aria-label={t("bench.sheet.label")}>
    <div className="quick-preview-heading">
      <h2>{bench.title || t("common.values.bench")}</h2>
      <p>{[bench.locationName, bench.elevationMeters === null ? null : t("bench.location.metresAboveSea", { value: Math.round(bench.elevationMeters) })].filter(Boolean).join(" · ") || t("bench.story.quietPlace")}</p>
    </div>
    <div className="quick-preview-facts" aria-label={t("bench.summary.title")}>
      <span><Sun size={17} aria-hidden="true" />{light}{bench.sunConfidence === "niedrig" && bench.sunnyNow !== null && bench.dayPhase !== "night" ? t("bench.summary.uncertain") : ""}</span>
      <span><Armchair size={17} aria-hidden="true" />{comfort}</span>
    </div>
    <div className="quick-preview-actions">
      {onJourney && <button type="button" className="quick-preview-route" onClick={onJourney}><Navigation size={18} aria-hidden="true" />{t("bench.story.directions")}</button>}
      <BenchSaveButton key={bench.id} bench={bench} user={user} onChanged={onChanged} />
    </div>
  </section>;
}
