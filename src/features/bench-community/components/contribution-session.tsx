"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/lib/types";

export type ContributionWork = { dirty: boolean; pending: boolean };
export const ContributionSession = createContext<((id: string, work: ContributionWork | null) => void) | null>(null);

/** Only in-memory work is tracked. Never put unsent text, photos or locations in storage. */
export function useContributionWork(dirty: boolean, pending = false) {
  const publish = useContext(ContributionSession);
  const id = useId();
  useEffect(() => { publish?.(id, { dirty, pending }); }, [publish, id, dirty, pending]);
  useEffect(() => () => publish?.(id, null), [publish, id]);
}

/** A refresh failure must not relabel a successfully stored contribution as a failed save. */
export function useContributionSave(onChanged?: () => void | Promise<void>) {
  const t = useTranslations();
  const [state, setState] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const lock = useRef(false);
  const save = (action: () => Promise<ActionResult>, onSaved?: () => void) => {
    if (lock.current) return;
    lock.current = true;
    setState(null);
    startTransition(async () => {
      try {
        const result = await action();
        setState(result);
        if (result.ok) {
          onSaved?.();
          try { await onChanged?.(); }
          catch { setState({ ...result, message: `${result.message} ${t("community.workspace.refreshFailed")}` }); }
        }
      } catch { setState({ ok: false, message: t("common.errors.unavailable") }); }
      finally { lock.current = false; }
    });
  };
  return { state, pending, save };
}

export function ContributionFeedback({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <p className={`contribution-feedback ${state.ok ? "is-success" : "is-error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p>;
}
