"use client";

import { Camera, ListChecks, MessageCircleHeart, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MouseEvent } from "react";
import type { ContributionMode } from "./bench-contribution-hub";

export function BenchContribute({ onChoose }: { onChoose: (chapter: ContributionMode) => void }) {
  const t = useTranslations();
  const choose = (event: MouseEvent<HTMLButtonElement>, chapter: ContributionMode) => {
    // Safari does not focus buttons on a pointer click. Establish the actual
    // invoker before the dialog captures focus, without moving the sheet.
    event.currentTarget.focus({ preventScroll: true });
    onChoose(chapter);
  };
  return <section className="bench-contribute" aria-label={t("community.hub.title")}>
    <h3>{t("bench.overview.contribute")}</h3>
    <div>
      <button type="button" onClick={(event) => choose(event, "all")}><Pencil size={17} aria-hidden="true" />{t("bench.overview.improve")}</button>
      <button type="button" onClick={(event) => choose(event, "features")}><ListChecks size={17} aria-hidden="true" />{t("community.chapters.features.title")}</button>
      <button type="button" onClick={(event) => choose(event, "photo")}><Camera size={17} aria-hidden="true" />{t("bench.overview.addPhoto")}</button>
      <button type="button" onClick={(event) => choose(event, "moment")}><MessageCircleHeart size={17} aria-hidden="true" />{t("bench.overview.addThought")}</button>
    </div>
  </section>;
}
