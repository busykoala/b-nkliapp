"use client";

import { Bookmark } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toggleBenchFollow } from "@/app/actions/bench-community";
import type { CurrentUser } from "@/lib/security";
import type { BenchDetail } from "@/lib/types";
import { AccountDialog } from "./account-controls";

export function BenchSaveButton({ bench, user, onChanged, className = "" }: {
  bench: BenchDetail;
  user: CurrentUser | null;
  onChanged?: () => void | Promise<void>;
  className?: string;
}) {
  const t = useTranslations();
  const dialog = useRef<HTMLDialogElement>(null);
  const saveAfterLogin = useRef(false);
  const [authenticated, setAuthenticated] = useState(Boolean(user));
  const [following, setFollowing] = useState(bench.followingBench);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => startTransition(async () => {
    try {
      const result = await toggleBenchFollow(bench.id, "bench");
      setMessage(result.message);
      if (!result.ok) return;
      setFollowing(Boolean(result.following));
      if (onChanged) await onChanged();
    } catch {
      setMessage(t("common.errors.unavailable"));
    }
  });
  const choose = () => {
    if (user || authenticated) save();
    else { saveAfterLogin.current = true; dialog.current?.showModal(); }
  };

  return <>
    <button type="button" className={`bench-save-action ${className}`} aria-pressed={following} disabled={pending} onClick={choose}>
      <Bookmark size={18} fill={following ? "currentColor" : "none"} aria-hidden="true" />
      <span>{following ? t("community.place.favourite") : t("community.place.save")}</span>
    </button>
    {message && <span className="bench-save-status" role="status">{message}</span>}
    <AccountDialog dialogRef={dialog} intent={t("community.place.save")} onAuthenticated={() => {
      setAuthenticated(true);
      if (saveAfterLogin.current) { saveAfterLogin.current = false; save(); }
    }} />
  </>;
}
