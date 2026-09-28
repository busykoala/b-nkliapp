"use client";

import { Bookmark } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { setBenchFollow } from "@/app/actions/bench-community";
import type { CurrentUser } from "@/lib/security";
import type { BenchDetail } from "@/lib/types";
import { AccountDialog } from "@/features/account/components/account-controls";

export function BenchSaveButton({ bench, user, onChanged, className = "", compact = false }: {
  bench: BenchDetail;
  user: CurrentUser | null;
  onChanged?: () => void | Promise<void>;
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations();
  const dialog = useRef<HTMLDialogElement>(null);
  const saveAfterLogin = useRef(false);
  const [authenticated, setAuthenticated] = useState(Boolean(user));
  const [following, setFollowing] = useState(bench.followingBench);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (desired: boolean) => startTransition(async () => {
    try {
      const result = await setBenchFollow(bench.id, desired);
      setMessage(result.message);
      if (!result.ok) return;
      setFollowing(Boolean(result.following));
      // The write succeeded. A failed background refresh must not label it a failed save.
      if (onChanged) await Promise.resolve().then(onChanged).catch(() => {});
    } catch {
      setMessage(t("common.errors.unavailable"));
    }
  });
  const choose = () => {
    if (user || authenticated) save(!following);
    else { saveAfterLogin.current = true; dialog.current?.showModal(); }
  };

  return <>
    <button type="button" className={`bench-save-action ${compact ? "is-compact" : ""} ${className}`} title={following ? t("community.place.favourite") : t("community.place.save")} aria-pressed={following} disabled={pending} onClick={choose}>
      <Bookmark size={18} fill={following ? "currentColor" : "none"} aria-hidden="true" />
      <span>{following ? t("community.place.favourite") : t("community.place.save")}</span>
    </button>
    {message && <span className="bench-save-status" role="status">{message}</span>}
    <AccountDialog dialogRef={dialog} intent={t("community.place.save")} onAuthenticated={() => {
      setAuthenticated(true);
      if (saveAfterLogin.current) { saveAfterLogin.current = false; save(true); }
    }} />
  </>;
}
