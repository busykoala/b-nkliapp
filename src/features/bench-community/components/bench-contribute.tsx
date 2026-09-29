"use client";

import { Camera, ListChecks, MessageCircleHeart, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ContributionMode } from "./bench-contribution-hub";

export function BenchContribute({ onChoose }: { onChoose: (chapter: ContributionMode) => void }) {
  const t = useTranslations();
  return <section className="bench-contribute" aria-label={t("community.hub.title")}>
    <h3>{t("bench.overview.contribute")}</h3>
    <div>
      <button type="button" onClick={() => onChoose("all")}><Pencil size={17} aria-hidden="true" />{t("bench.overview.improve")}</button>
      <button type="button" onClick={() => onChoose("features")}><ListChecks size={17} aria-hidden="true" />{t("community.chapters.features.title")}</button>
      <button type="button" onClick={() => onChoose("photo")}><Camera size={17} aria-hidden="true" />{t("bench.overview.addPhoto")}</button>
      <button type="button" onClick={() => onChoose("moment")}><MessageCircleHeart size={17} aria-hidden="true" />{t("bench.overview.addThought")}</button>
    </div>
  </section>;
}
