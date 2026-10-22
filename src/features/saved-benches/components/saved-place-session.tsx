"use client";

import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { setBenchFollow } from "@/app/actions/bench-community";
import styles from "./saved-place-session.module.css";

const UndoContext = createContext<((id: string, title: string, message: string) => void) | null>(null);
export const useSavedPlaceUndo = () => useContext(UndoContext);

/** Keep removal feedback outside the row that the action's revalidation removes. */
export function SavedPlaceSession({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const [removed, setRemoved] = useState<{ id: string; title: string; message: string } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const feedback = useRef<HTMLDivElement>(null);
  return <UndoContext.Provider value={(id, title, message) => {
    setRemoved({ id, title, message }); setError("");
    requestAnimationFrame(() => feedback.current?.focus());
  }}>
    {removed && <div ref={feedback} tabIndex={-1} role="status" className={styles.feedback}>
      <span>{removed.message}<small>{removed.title}</small></span>
      <button type="button" disabled={pending} onClick={() => startTransition(async () => {
        const result = await setBenchFollow(removed.id, true);
        if (result.ok) { setRemoved(null); setError(""); }
        else setError(result.message);
      })}><RotateCcw size={18} aria-hidden="true" />{t("community.observations.undo")}</button>
      {error && <p role="alert">{error}</p>}
    </div>}
    {children}
  </UndoContext.Provider>;
}
