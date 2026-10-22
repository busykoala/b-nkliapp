"use client";

import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { BenchDetail } from "@/lib/types";

const choices = [
  { task: "moment", label: "memory" },
  { task: "features", label: "facts" },
  { task: "correction", label: "problem" },
] as const;
export type ContributionTask = "features" | "photo" | "moment" | "rating" | "care" | "correction" | "presence";
export type ContributionMode = ContributionTask | "all";

export function ContributionChooser({ onChoose }: { bench: BenchDetail; onChoose: (task: ContributionTask) => void }) {
  const t = useTranslations();
  return <nav className="contribution-chooser" aria-label={t("community.workspace.choose")}>
    <p className="contribution-intro">{t("community.workspace.intro")}</p>
    <div className="contribution-task-grid">{choices.map(({ task, label }) => <button type="button" key={task} data-contribution-choice={task} aria-label={t(`community.concerns.${label}.title`)} onClick={() => onChoose(task)}>
      <span className="contribution-concern-copy"><strong>{t(`community.concerns.${label}.title`)}</strong><small>{t(`community.concerns.${label}.hint`)}</small></span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>)}</div>
  </nav>;
}

export function contributionConcern(task: ContributionTask): "moment" | "features" | "correction" {
  return ["photo", "rating", "moment"].includes(task) ? "moment" : task === "features" ? "features" : "correction";
}
