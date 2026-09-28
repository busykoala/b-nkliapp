"use client";

import { Navigation, Pencil, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { CurrentUser } from "@/lib/security";
import type { BenchDetail } from "@/lib/types";
import { canonicalBenchShareUrl } from "@/lib/bench-share";
import { BenchSaveButton } from "@/features/saved-benches/components/bench-save-button";
import { useLocalBenchLanguage } from "./local-bench-language-provider";

export type BenchHeaderProps = {
  bench: BenchDetail;
  user: CurrentUser | null;
  onJourney?: () => void;
  journeyHref?: string;
  onChanged?: () => void | Promise<void>;
  onEdit: () => void;
};

export function BenchHeader({ bench, user, onJourney, journeyHref, onChanged, onEdit }: BenchHeaderProps) {
  const t = useTranslations();
  const localLanguage = useLocalBenchLanguage();
  const [notice, setNotice] = useState<string | null>(null);
  const elevationMeters = bench.elevationMeters;
  const elevationLabel = typeof elevationMeters === "number" && Number.isFinite(elevationMeters)
    ? t("bench.location.metresAboveSea", { value: Math.round(elevationMeters) })
    : null;
  const location = [bench.locationName, elevationLabel].filter(Boolean).join(" · ");
  const share = async () => {
    const title = bench.title || t("common.values.bench");
    setNotice(null);
    try {
      const data = { title, text: t("community.place.shareText", { bench: title }), url: canonicalBenchShareUrl(window.location.href, bench.id) };
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(`${data.text} ${data.url}`); setNotice(t("community.place.copied")); }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setNotice(t("community.place.shareUnavailable"));
    }
  };
  return <header className="bench-header">
    <h2>{bench.title || t("common.values.bench")}</h2>
    {location && <p className="bench-location">{location}</p>}
    {localLanguage.active && <p className="bench-local-language">{t("common.language.localActive", { region: localLanguage.profile.regionLabel })}</p>}
    <div className="bench-actions">
      {onJourney ? <button type="button" className="bench-route-action" onClick={onJourney}><Navigation size={18} aria-hidden="true" />{t("bench.story.directions")}</button>
        : journeyHref && <a className="bench-route-action" href={journeyHref}><Navigation size={18} aria-hidden="true" />{t("bench.story.directions")}</a>}
      <BenchSaveButton key={bench.id} bench={bench} user={user} onChanged={onChanged} compact />
      <button type="button" className="bench-icon-action" aria-label={t("community.place.share")} title={t("community.place.share")} onClick={() => void share()}><Share2 size={18} aria-hidden="true" /></button>
      <button type="button" className="bench-icon-action" aria-label={t("community.chapters.features.title")} title={t("community.chapters.features.title")} onClick={onEdit}><Pencil size={18} aria-hidden="true" /></button>
    </div>
    {notice && <p className="bench-action-status" role="status">{notice}</p>}
  </header>;
}
