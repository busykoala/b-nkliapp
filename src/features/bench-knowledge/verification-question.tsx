"use client";
import { useTranslations } from "next-intl";

import { useState, useTransition } from "react";
import { answerBenchQuestion } from "@/app/actions/bench-verification";
import type { VerificationQuestion as Question } from "./model";

export function VerificationQuestion({ benchId, question, onChanged }: { benchId: string; question: Question; onChanged?: () => void | Promise<void> }) {
  const t = useTranslations();
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  if (dismissed) return message ? <p className="verification-thanks" role="status">{message}</p> : null;
  const answer = (value: 0 | 1 | null) => startTransition(async () => {
    try {
      const result = await answerBenchQuestion({ benchId, attribute: question.attribute, value });
      setMessage(result.message);
      if (result.ok) { setDismissed(true); await onChanged?.(); }
    } catch { setMessage(t("knowledge.verification.failed")); }
  });
  return <section className="verification-question" aria-label={t("knowledge.verification.label")}><small>{t("knowledge.verification.intro")}</small><h3>{t(`knowledge.verification.questions.${question.attribute}`)}</h3><p>{t(`knowledge.verification.reasons.${question.reason}`)}</p><div>
    <button className="ui-button" disabled={pending} onClick={() => answer(1)}>{t("common.values.yes")}</button><button className="ui-button" disabled={pending} onClick={() => answer(0)}>{t("common.values.no")}</button><button className="ui-button" disabled={pending} onClick={() => answer(null)}>{t("knowledge.verification.unknown")}</button>
  </div>{message && <p role="status">{message}</p>}</section>;
}
