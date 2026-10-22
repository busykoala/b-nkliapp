"use client";

import { AlertTriangle, Armchair, ChevronRight, Star, Sun, Ear } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { BenchDetail } from "@/lib/types";
import { visitHints, validRating, visitAccessState } from "../overview";

/** A couple of useful sentences, rather than a dashboard of measurements. */
export function BenchOverview({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const icons = { light: Sun, seating: Armchair, noise: Ear };
  const hints = visitHints(bench, t);
  if (!hints.length) return null;
  return <section className="bench-overview visit-essentials" aria-label={t("bench.summary.title")}>
    {hints.map(hint => { const Icon = icons[hint.kind]; return <p key={hint.kind} data-visit-hint={hint.kind}><Icon size={18} aria-hidden="true" /><span>{hint.text}</span></p>; })}
  </section>;
}

export function BenchVisitWarnings({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const access = visitAccessState(bench);
  return <aside className="bench-visit-warnings" aria-label={t("bench.visit.accessTitle")}>
    {bench.removalConfirmationCount > 0 && <p className="is-caution"><AlertTriangle size={18} aria-hidden="true" />{t("bench.visit.possiblyMissing")}</p>}
    {access.steps && <p className="is-caution"><AlertTriangle size={18} aria-hidden="true" />{t("bench.overview.steps")}</p>}
    {access.obstacle && <p className="is-caution"><AlertTriangle size={18} aria-hidden="true" />{t("bench.visit.obstacle")}</p>}
  </aside>;
}

export function BenchRatingLink({ bench, onReviews }: { bench: BenchDetail; onReviews: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const rating = validRating(bench.ratingAverage, bench.ratingCount);
  if (rating === null) return null;
  return <button type="button" className="overview-rating rating-summary-action" onClick={onReviews} aria-label={`${t("bench.story.ratings")}. ${t("bench.story.ratingSummary", { score: format.number(rating, { maximumFractionDigits: 1 }), count: bench.ratingCount })}`}>
    <span><Star size={17} aria-hidden="true" /><strong>{format.number(rating, { maximumFractionDigits: 1 })}</strong> / 5 · {t("bench.overview.ratings", { count: bench.ratingCount })}</span><ChevronRight size={17} aria-hidden="true" />
  </button>;
}
