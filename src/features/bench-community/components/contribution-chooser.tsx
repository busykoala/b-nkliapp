"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Binoculars, Camera, ChevronRight, HeartHandshake, ListChecks, MessageCircleHeart, Moon, Star, Sun } from "lucide-react";
import type { BenchDetail } from "@/lib/types";

const groups = [
  { id: "place", tasks: ["features", "photo"] },
  { id: "now", tasks: ["light", "view"] },
  { id: "experience", tasks: ["moment", "rating"] },
  { id: "care", tasks: ["care", "correction"] },
] as const;
const icons = { features: ListChecks, photo: Camera, light: Sun, view: Binoculars, moment: MessageCircleHeart, rating: Star, care: HeartHandshake, correction: AlertTriangle };
export type ContributionTask = keyof typeof icons | "presence";
export type ContributionMode = ContributionTask | "all";

export function ContributionChooser({ bench, onChoose }: { bench: BenchDetail; onChoose: (task: ContributionTask) => void }) {
  const t = useTranslations();
  return <nav className="contribution-chooser" aria-label={t("community.workspace.choose")}>
    <p className="contribution-intro">{t("community.workspace.intro")}</p>
    {groups.map((group) => <section key={group.id}>
      <h3>{t(`community.workspace.groups.${group.id}`)}</h3>
      <div className="contribution-task-grid">{group.tasks.map((task) => {
        const Icon = task === "light" && bench.dayPhase === "night" ? Moon : icons[task];
        return <button type="button" key={task} data-contribution-choice={task} aria-label={t(`community.chapters.${task}.title`)} onClick={() => onChoose(task)}>
          <span className={`contribution-task-icon is-${task}`} aria-hidden="true"><Icon size={21} /></span>
          <span><strong>{t(`community.chapters.${task}.title`)}</strong><small>{t(`community.workspace.hints.${task}`)}</small></span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>;
      })}</div>
    </section>)}
  </nav>;
}
