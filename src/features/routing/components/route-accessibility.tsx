"use client";

import { Footprints, Route, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { surfaceLabel } from "@/i18n/approach-labels";
import type { RouteAccessibility } from "@/features/journey/model";
import { aggregateRouteAccessibility } from "@/features/routing/accessibility";

export function RouteAccessibilitySummary({ values }: { values: Array<RouteAccessibility | undefined> }) {
  const t = useTranslations();
  if (!values.length) return null;
  const assessment = aggregateRouteAccessibility(values);

  return <section className="route-accessibility" aria-label={t("routing.accessibility.title")}>
    <header><Route size={17} /><strong>{t("routing.accessibility.title")}</strong></header>
    <div>
      <span className={assessment.steps === "present" ? "is-warning" : undefined}><Footprints size={16} />{assessment.steps === "present"
        ? t("routing.accessibility.steps", { distance: Math.max(1, assessment.stepsDistanceMeters) })
        : assessment.steps === "none" ? t("routing.accessibility.noSteps") : t("routing.accessibility.stepsUnknown")}</span>
      {assessment.maximumSlopePercent !== null && <span><TrendingUp size={16} />{t("routing.accessibility.slope", { value: Math.round(assessment.maximumSlopePercent) })}</span>}
    </div>
    {assessment.surfaces.length > 0 && <p>{t("routing.accessibility.surfaces", { values: assessment.surfaces.map((surface) => surfaceLabel(surface, t)).join(" · ") })}</p>}
    <small>{assessment.coverage === "complete" ? t("routing.accessibility.coverageComplete")
      : assessment.coverage === "partial" ? t("routing.accessibility.coveragePartial", { assessed: assessment.assessedSections, total: assessment.expectedSections })
        : t("routing.accessibility.coverageNone")}</small>
    <small>{t("routing.accessibility.note")}</small>
  </section>;
}
