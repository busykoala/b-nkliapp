"use client";
import { useState, useTransition } from "react";
import { answerBenchQuestion } from "@/app/actions/bench-verification";
import type { VerificationQuestion as Question } from "./model";

export function VerificationQuestion({ benchId, question, onChanged }: { benchId: string; question: Question; onChanged?: () => void | Promise<void> }) {
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  if (dismissed) return message ? <p className="verification-thanks" role="status">{message}</p> : null;
  const answer = (value: 0 | 1 | null) => startTransition(async () => {
    try {
      const result = await answerBenchQuestion({ benchId, attribute: question.attribute, value });
      setMessage(result.message);
      if (result.ok) { setDismissed(true); await onChanged?.(); }
    } catch { setMessage("Die Antwort konnte nicht gespeichert werden. Bitte versuche es noch einmal."); }
  });
  return <section className="verification-question" aria-label="Eine kurze Frage vor Ort"><small>Wenn du gerade hier bist</small><h3>{question.text}</h3><p>{question.reason}</p><div>
    <button className="ui-button" disabled={pending} onClick={() => answer(1)}>Ja</button><button className="ui-button" disabled={pending} onClick={() => answer(0)}>Nein</button><button className="ui-button" disabled={pending} onClick={() => answer(null)}>Weiss ich nicht</button>
  </div>{message && <p role="status">{message}</p>}</section>;
}
