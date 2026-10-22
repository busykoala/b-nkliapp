"use client";

import { ArrowUpRight, Share2 } from "lucide-react";
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
};

export function BenchHeader({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const localLanguage = useLocalBenchLanguage();
  return <header className="bench-header">
    <h2>{bench.title || t("common.values.bench")}</h2>
    {bench.locationName && bench.locationName !== bench.title && <p className="bench-location">{bench.locationName}</p>}
    {localLanguage.active && <p className="bench-local-language">{t("common.language.localActive", { region: localLanguage.profile.regionLabel })}</p>}
  </header>;
}

export function BenchActions({ bench, user, onJourney, journeyHref, onChanged }: BenchHeaderProps) {
  const t = useTranslations();
  return <div className="bench-action-group">
    <div className="bench-actions">
      {onJourney ? <button type="button" className="bench-route-action" data-sheet-focus="bench-route" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onJourney(); }}><span>{t("bench.story.directions")}</span><ArrowUpRight size={22} aria-hidden="true" /></button>
        : journeyHref && <a className="bench-route-action" href={journeyHref}><span>{t("bench.story.directions")}</span><ArrowUpRight size={22} aria-hidden="true" /></a>}
      <BenchSaveButton key={bench.id} bench={bench} user={user} onChanged={onChanged} compact />
    </div>
  </div>;
}

export function BenchShareAction({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const [notice, setNotice] = useState<string | null>(null);
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
  return <div className="bench-share"><button type="button" onClick={() => void share()}><Share2 size={18} aria-hidden="true" />{t("community.place.share")}</button>{notice && <p role="status">{notice}</p>}</div>;
}
