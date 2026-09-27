"use client";

import { Footprints, Route, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { surfaceLabel } from "@/i18n/approach-labels";
import type { RouteAccessibility } from "@/lib/journey";

export function RouteAccessibilitySummary({ values }: { values: Array<RouteAccessibility | undefined> }) {
  const t = useTranslations();
  const known = values.filter((value): value is RouteAccessibility => Boolean(value));
  if (!known.length) return null;
  const hasSteps = known.some((value) => value.steps === "present");
  const stepsKnown = known.every((value) => value.steps !== "unknown");
  const stepsDistance = known.reduce((sum, value) => sum + value.stepsDistanceMeters, 0);
  const slopes = known.flatMap((value) => value.maximumSlopePercent === null ? [] : [value.maximumSlopePercent]);
  const surfaces = [...new Set(known.flatMap((value) => value.surfaces))].slice(0, 3);

  return <section className="route-accessibility" aria-label={t("routing.accessibility.title")}>
    <header><Route size={17} /><strong>{t("routing.accessibility.title")}</strong></header>
    <div>
      <span className={hasSteps ? "is-warning" : undefined}><Footprints size={16} />{hasSteps
        ? t("routing.accessibility.steps", { distance: Math.max(1, stepsDistance) })
        : stepsKnown ? t("routing.accessibility.noSteps") : t("routing.accessibility.stepsUnknown")}</span>
      {slopes.length > 0 && <span><TrendingUp size={16} />{t("routing.accessibility.slope", { value: Math.round(Math.max(...slopes)) })}</span>}
    </div>
    {surfaces.length > 0 && <p>{t("routing.accessibility.surfaces", { values: surfaces.map((surface) => surfaceLabel(surface, t)).join(" · ") })}</p>}
    <small>{t("routing.accessibility.note")}</small>
  </section>;
}
