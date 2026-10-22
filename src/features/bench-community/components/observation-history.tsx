"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { formatDate } from "@/i18n/date";
import { deleteOwnObservation } from "@/features/bench-observations/actions";
import { ContributionFeedback, useContributionSave } from "./contribution-session";

/** Existing personal evidence remains manageable without inviting new questionnaires. */
export function ObservationHistory({ bench, onChanged }: { bench: BenchDetail; onChanged?: () => void | Promise<void> }) {
  const t = useTranslations();
  const [removed, setRemoved] = useState<string[]>([]);
  const { state, pending, save } = useContributionSave(onChanged);
  const entries = (["light", "view"] as const).filter(kind => bench.observations[kind].mine && !removed.includes(kind));
  if (!entries.length && !state) return null;
  return <details className="observation-history"><summary>{t("community.history.title")}</summary>
    {entries.map(kind => { const mine = bench.observations[kind].mine!; return <div key={kind}>
      <p><strong>{t(`community.chapters.${kind}.title`)}</strong><span>{kind === "light" && "choice" in mine ? t(`community.observations.light.choices.${mine.choice}`) : t("community.history.view")}</span><time dateTime={mine.observedAt}>{formatDate(mine.observedAt, t)}</time></p>
      <button type="button" disabled={pending} aria-label={t("community.history.remove", { kind: t(`community.chapters.${kind}.title`) })} onClick={() => save(() => deleteOwnObservation(bench.id, kind), () => setRemoved(previous => [...previous, kind]))}><Trash2 size={18} aria-hidden="true" />{t("common.actions.delete")}</button>
    </div>; })}
    <ContributionFeedback state={state} />
  </details>;
}
