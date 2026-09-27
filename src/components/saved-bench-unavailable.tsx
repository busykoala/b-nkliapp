"use client";

import { Bookmark, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setBenchFollow } from "@/app/actions/bench-community";

export function SavedBenchUnavailable({ id, title, detail }: { id: string; title: string; detail: string }) {
  const t = useTranslations();
  const [removed, setRemoved] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const change = (following: boolean) => startTransition(async () => {
    const result = await setBenchFollow(id, following);
    setMessage(result.message);
    if (result.ok) setRemoved(!following);
  });

  if (removed) return <div className="saved-bench-unavailable is-removed" role="status">
    <Bookmark size={20} /><span><strong>{message}</strong><small>{title}</small></span>
    <button type="button" disabled={pending} onClick={() => change(true)}><RotateCcw size={17} />{t("community.observations.undo")}</button>
  </div>;

  return <div className="saved-bench-unavailable">
    <Bookmark size={20} /><span><strong>{title}</strong><small>{detail}</small></span>
    <button type="button" disabled={pending} aria-label={`${t("common.actions.remove")} · ${title}`} onClick={() => change(false)}><X size={17} />{t("common.actions.remove")}</button>
    {message && <small role="alert">{message}</small>}
  </div>;
}
