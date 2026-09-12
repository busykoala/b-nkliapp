"use client";

import { MessagesSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import type { DialectMode } from "@/lib/dialect";

export const dialectStorageKey = "benchly_dialect_mode";
export const dialectEvent = "benchly:dialect-mode";

function savedMode(): DialectMode {
  if (typeof window === "undefined") return "off";
  const value = window.localStorage.getItem(dialectStorageKey);
  return value === "regional" || value === "playful" ? value : "off";
}

export function DialectSwitcher() {
  const t = useTranslations("common.dialect");
  const mode = useDialectMode();
  return <div className="dialect-preference">
    <label className="dialect-switcher"><MessagesSquare size={19} /><span>{t("label")}</span>
      <select aria-label={t("label")} value={mode} onChange={(event) => {
        const next = event.target.value as DialectMode;
        window.localStorage.setItem(dialectStorageKey, next);
        window.dispatchEvent(new CustomEvent(dialectEvent, { detail: next }));
      }}>
        <option value="off">{t("off")}</option>
        <option value="regional">{t("regional")}</option>
        <option value="playful">{t("playful")}</option>
      </select>
    </label>
    <p>{t("hint")}</p>
  </div>;
}

export function useDialectMode() {
  return useSyncExternalStore<DialectMode>((update) => {
    window.addEventListener(dialectEvent, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(dialectEvent, update);
      window.removeEventListener("storage", update);
    };
  }, savedMode, (): DialectMode => "off");
}
