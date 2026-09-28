"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Flag, MessageCircleHeart } from "lucide-react";
import { formatDate } from "@/i18n/date";
import type { MessageKey } from "@/i18n/types";
import type { BenchDetail } from "@/lib/types";
import type { CurrentUser } from "@/lib/security";

const correctionLabels: Record<string, MessageKey> = {
  properties: "community.correction.fields.properties",
  condition: "community.correction.fields.condition",
  location: "community.correction.fields.location",
  removed: "community.correction.fields.removed",
  environment: "community.correction.fields.environment",
};

export function BenchReviews({ bench, report, reported, user, onContribute }: { bench: BenchDetail; reported: Set<string>; report: (type: "rating" | "correction", id: number) => void; user: CurrentUser | null; onContribute: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  return <div className="community-page">
    <header><small>{t("community.reviews.eyebrow")}</small><h3>{t("community.reviews.title")}</h3></header>
    {bench.ratingBreakdown && <div className="rating-line">{([
      [t("community.rating.fields.overall"), bench.ratingBreakdown.overall, bench.ratingBreakdown.counts.overall],
      [t("community.rating.fields.view"), bench.ratingBreakdown.view, bench.ratingBreakdown.counts.view],
      [t("community.rating.fields.comfort"), bench.ratingBreakdown.comfort, bench.ratingBreakdown.counts.comfort],
      [t("community.rating.fields.quiet"), bench.ratingBreakdown.quiet, bench.ratingBreakdown.counts.quiet],
    ] as const).filter(([, value]) => value !== null).map(([label, value, count]) => <span key={label}><strong>{format.number(value!, {maximumFractionDigits: 1})}</strong><small>{label} · {count}</small></span>)}</div>}
    {user
      ? <button type="button" className="community-contribute-entry" onClick={onContribute}><MessageCircleHeart size={17} /> {bench.myRating ? t("community.reviews.edit") : t("community.reviews.add")}</button>
      : <button type="button" className="community-contribute-entry" onClick={onContribute}><MessageCircleHeart size={17} /> {t("community.reviews.signIn")}</button>}
    {bench.recentRatings.map((rating) => <article key={rating.id} className="quiet-contribution"><div><strong>{rating.overall}/5</strong><time>{formatDate(rating.createdAt, t)}</time><button disabled={reported.has(`rating-${rating.id}`)} aria-label={reported.has(`rating-${rating.id}`) ? t("community.reviews.reportedRating") : t("community.reviews.reportRating")} onClick={() => report("rating", rating.id)}><Flag size={14} /></button></div>{rating.note && <p lang={bench.dialectPresentation?.appLanguageTag}>{rating.note}</p>}</article>)}
    {bench.corrections.length > 0 && <section className="community-notes"><h3>{t("community.reviews.notes")}</h3>{bench.corrections.map((item) => <article key={item.id} className="quiet-contribution"><div><small>{correctionLabels[item.field] ? t(correctionLabels[item.field]) : item.field}</small><button disabled={reported.has(`correction-${item.id}`)} aria-label={reported.has(`correction-${item.id}`) ? t("community.reviews.reportedCorrection") : t("community.reviews.reportCorrection")} onClick={() => report("correction", item.id)}><Flag size={14} /></button></div><strong lang={bench.dialectPresentation?.appLanguageTag}>{item.proposedValue}</strong>{item.note && <p lang={bench.dialectPresentation?.appLanguageTag}>{item.note}</p>}</article>)}</section>}
  </div>;
}
