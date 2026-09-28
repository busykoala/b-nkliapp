"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BenchDetail } from "@/lib/types";
import type { CurrentUser } from "@/lib/security";
import { AccountDialog } from "@/features/account/components/account-controls";
import { BenchContributionHub, type ContributionMode } from "./bench-contribution-hub";

export function useBenchContributions(bench: BenchDetail, user: CurrentUser | null, onChanged: () => void | Promise<void>) {
  const t = useTranslations();
  const account = useRef<HTMLDialogElement>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [chapter, setChapter] = useState<ContributionMode>("all");
  const [open, setOpen] = useState(false);
  const signedIn = Boolean(user) || authenticated;
  const contribute = (next: ContributionMode = "all") => {
    setChapter(next);
    if (signedIn) setOpen(true);
    else account.current?.showModal();
  };
  const intent = chapter === "rating" ? t("bench.story.rateIntent")
    : t(chapter === "all" ? "community.hub.title" : `community.chapters.${chapter}.title`);
  const dialogs = <>
    {signedIn && open && <BenchContributionHub key={`${bench.id}-${chapter}`} bench={bench} open initialChapter={chapter} onClose={() => setOpen(false)} onChanged={onChanged} />}
    <AccountDialog dialogRef={account} intent={intent} onAuthenticated={() => {
      setAuthenticated(true);
      setOpen(true);
      void Promise.resolve().then(onChanged).catch(() => {}); // Authentication succeeded; a refresh must not lose the chosen contribution.
    }} />
  </>;
  return { contribute, dialogs, signedIn };
}
