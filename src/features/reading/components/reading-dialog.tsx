"use client";

import { useEffect, useId, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import { resolveEssayLanguage } from "../model";
import { ReadingView } from "./reading-view";

/** A native modal leaves the menu and the current map/bench/walk mounted beneath it. */
export function ReadingDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("reading");
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => element.close();
  }, []);

  return <dialog ref={dialog} className="reading-dialog" aria-labelledby={titleId} onClose={() => {
    // A Strict Mode cleanup can queue a close event before the dialog reopens.
    if (!dialog.current?.open) onClose();
  }} onCancel={(event) => event.stopPropagation()}>
    <header className="reading-dialog-bar">
      <h2 ref={heading} id={titleId} tabIndex={-1}>{t("essay")}</h2>
      <button type="button" onClick={() => dialog.current?.close()} aria-label={t("closeReading")}><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="reading-dialog-scroll">
      <ReadingView initialLanguage={resolveEssayLanguage(undefined, locale)} />
      <button type="button" className="reading-return" onClick={() => dialog.current?.close()}>{t("article.back")}</button>
    </div>
  </dialog>;
}
