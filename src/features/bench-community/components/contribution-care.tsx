"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Hammer, HeartHandshake, MessageCircleHeart, Sparkles } from "lucide-react";
import { submitBenchCare } from "@/app/actions/bench-community";
import type { BenchCareKind, BenchDetail } from "@/lib/types";
import { ContributionFeedback, useContributionSave, useContributionWork } from "./contribution-session";

const careActions = [
  ["cleaned", Sparkles], ["good", Check], ["repair", Hammer], ["beautiful", MessageCircleHeart],
] as const;

export function CareActions({ bench, onChanged }: { bench: BenchDetail; onChanged?: () => void | Promise<void> }) {
  const t = useTranslations();
  const [mine, setMine] = useState(new Set(bench.care.mine));
  const { state, pending, save } = useContributionSave(onChanged);
  useContributionWork(false, pending);
  const submit = (kind: BenchCareKind) => save(() => submitBenchCare(bench.id, kind), () => setMine((current) => new Set(current).add(kind)));
  return <div className="care-actions"><p><HeartHandshake size={17} aria-hidden="true" />{t("community.care.description")}</p><div>{careActions.map(([kind, Icon]) => <button type="button" key={kind} disabled={pending || mine.has(kind)} onClick={() => submit(kind)}><Icon size={18} aria-hidden="true" /><span>{mine.has(kind) ? t("community.care.mine", { label: t(`community.care.actions.${kind}`) }) : t(`community.care.actions.${kind}`)}</span></button>)}</div><ContributionFeedback state={state} /></div>;
}
